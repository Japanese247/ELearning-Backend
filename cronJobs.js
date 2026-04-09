const cron = require("node-cron");
const Bookings = require("./model/booking");
const Teacher = require("./model/teacher");
const Zoom = require("./model/Zoom");
const TeacherAvailability = require("./model/TeacherAvailability");
const { updateCurrencyRatesJob } = require("./controller/currencycontroller");
const sendEmail = require("./utils/EmailMailler");
const currency = require("./EmailTemplate/currency");
const Reminder = require("./EmailTemplate/Reminder");
const TeacherReminder = require("./EmailTemplate/TeacherReminder");
const StudentLessonDone = require("./EmailTemplate/StudentLessonDone");
const TeacherLessonDone = require("./EmailTemplate/TeacherLessonDone");
const { DateTime } = require("luxon");
const { createZoomMeeting } = require("./zoommeeting");
const logger = require("./utils/Logger");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Message = require("./model/message");
const User = require("./model/user");
const MessageTemplate = require("./EmailTemplate/Message");
const { getValidGoogleClient } = require("./utils/GoogleCalendar");

module.exports = () => {

  cron.schedule("* * * * *", async () => {
    try {
      // console.log(`Running cron job at ${new Date().toISOString()}`);
      const now = new Date(); // current time in UTC
      const endNow = DateTime.utc().startOf("minute"); // e.g., 13:42:00
      console.log("crons started");
      const data = await Bookings.find({
        startDateTime: { $gt: now },
        cancelled: false,
        // _id: "68924c90795dd1d2abaee90a",
      })
        .populate("teacherId")
        .populate("UserId")
        .populate("LessonId")
        .populate("zoom")
        .sort({ startDateTime: 1 });
      // console.log("data",data);

      const registrationSubject = "Reminder for Booking ⏰";
      for (const booking of data) {
        const objectId = new mongoose.Types.ObjectId(booking?.teacherId?._id);
        const teacherData = await Teacher.findOne({ userId: objectId });
        // console.log("TeacherData",teacherData);
        const nowTime = DateTime.utc();
        const startUTC = DateTime.fromJSDate(booking.startDateTime).toUTC();
        const diffInMinutes = Math.round(
          startUTC.diff(nowTime, "minutes").minutes
        );
        // console.log("startUTC",startUTC);
        // console.log("nowTime",nowTime);
        // console.log("diffInMinutes",diffInMinutes);
        let time = diffInMinutes;
        // if (diffInMinutes === 1440) time = "24 hours";
        // else if (diffInMinutes === 120) time = "2 hours";
        // else if (diffInMinutes === 30) time = "30 minutes";
         
        if (diffInMinutes <= 30 && diffInMinutes >= 0 && !booking.zoom) {
          if(diffInMinutes > 1){
            time = `${diffInMinutes} minutes`;
          } else { 
            time = `just a moment`;
          }
          console.log("crons executed for zoom link");
        } else {
          console.log("crons ended with continue");
          continue;

        }
 
        let zoomLink = null;
        async function createBookingLink () { 
          console.log(`Creating Zoom meeting for booking ID: ${booking._id}`);
          logger.info(`Creating Zoom meeting for booking ID: ${booking._id}`);

          // Generate a safe random password (>= 8 alphanumeric chars)
          const generatedPassword = Math.random().toString(36).slice(-8);
          const meetingDetails = {
            topic: booking?.LessonId?.title || "Lesson booking",
            type: 2, // Scheduled meeting
            start_time: booking.startDateTime.toISOString(),
            duration: booking?.LessonId?.duration || 60,
            password: generatedPassword,
            timezone: "UTC",
            settings: {
              auto_recording: "cloud",
              host_video: true,
              participant_video: true,
              mute_upon_entry: true,
              join_before_host: true,
              waiting_room: false,
            },
          };
          // const result = await createZoomMeeting(meetingDetails);
          const result = await createZoomMeeting(
            meetingDetails,
            teacherData,
            Teacher
          );

          if (!result?.meeting_id) {
            logger.error(`❌ Failed to create meeting for booking ${booking._id}`)
            return; 
          }

          zoomLink = result?.meeting_url || "";
          // console.log("result",result);
          logger.info(
            "Meeting link generated successfully with",
            result?.meeting_id
          );
          // console.log("Sending email for booking",booking._id);
          const zoomRecord = new Zoom({
            meetingId: result?.meeting_id || "",
            meetingLink: result?.meeting_url || "",
          });
          const zoomResult = await zoomRecord.save();
          booking.zoom = zoomResult._id; // Save the Zoom meeting ID in the booking
          await booking.save();
        }

        if (!booking.zoom) {
          await createBookingLink();
        }

        logger.info("Sending email for booking", booking._id);
        const user = booking?.UserId;
        const teacher = booking?.teacherId;
        const lesson = booking?.LessonId;

        const userName = user?.name || "";
        const teacherName = teacher?.name || "";
        const lessonName = lesson?.title || "";

        // Sending email to student
        const emailHtml = Reminder(
          userName,
          zoomLink ||
            booking.zoom?.meetingLink ||
            "https://akitainakaschoolonline.com/student/lessons",
          time,
          teacherName,
          lessonName
        );

        await sendEmail({
          email: user.email,
          subject: registrationSubject,
          emailHtml: emailHtml,
        });

        logger.info(`📧 Reminder email sent to user ${user.email}`);

        // Sending email to teacher
        const TeacherEmailHtml = TeacherReminder(
          userName,
          zoomLink ||
            booking.zoom?.meetingLink ||
            "https://akitainakaschoolonline.com/teacher-dashboard/booking",
          time,
          teacherName,
          lessonName
        );

        await sendEmail({
          email: teacher.email,
          subject: registrationSubject,
          emailHtml: TeacherEmailHtml,
        });

        logger.info(`📧 Reminder email sent to teacher ${teacher.email}`);
      }

      // Sending lesson done emails to user and teacher
      const justEndedBookings = await Bookings.find({
        cancelled: false,
        endDateTime: {
          $gte: endNow.toJSDate(),
          $lt: endNow.plus({ minutes: 1 }).toJSDate(), // match to current minute
        },
        // "_id": "686271edc0b8706b75e81101",
      })
        .populate("teacherId")
        .populate("UserId")
        .populate("LessonId");

      // console.log("justEndedBookings",justEndedBookings);
      for (const booking of justEndedBookings) {
        const user = booking?.UserId;
        const teacher = booking?.teacherId;

        const userName = user?.name || "";
        const teacherName = teacher?.name || "";

        // const token = jwt.sign(
        //   { BookingId: booking._id, UserId: booking?.UserId },
        //   process.env.JWT_SECRET_KEY,
        //   { expiresIn: process.env.JWT_EXPIRES_IN || "365d" }
        // );

        // const studentDoneEmailHtml = StudentLessonDone(
        //   userName,
        //   teacherName,
        //   `https://akitainakaschoolonline.com/confirm-lesson/${token}`
        // );

        // await sendEmail({
        //   email: user.email,
        //   subject: "Please confirm your lesson completion ✅",
        //   emailHtml: studentDoneEmailHtml,
        // });

        // logger.info(`📧 StudentLessonDone email sent to ${user.email} for booking ${booking._id}`);
        // console.log(`📧 StudentLessonDone email sent to ${user.email} for booking ${booking._id}`);

        // Lesson done email to teacher
        const teacherToken = jwt.sign(
          { BookingId: booking._id, teacherId: booking?.teacherId },
          process.env.JWT_SECRET_KEY,
          { expiresIn: process.env.JWT_EXPIRES_IN || "365d" }
        );

        const teacherDoneEmailHtml = TeacherLessonDone(
          userName,
          teacherName,
          `https://akitainakaschoolonline.com/confirm-lesson/${teacherToken}`
        );

        await sendEmail({
          email: teacher.email,
          subject: "Please confirm your lesson completion ✅",
          emailHtml: teacherDoneEmailHtml,
        });

        logger.info(
          `📧 TeacherLessonDone email sent to ${teacher.email} for booking ${booking._id}`
        );
        console.log(
          `📧 TeacherLessonDone email sent to ${teacher.email} for booking ${booking._id}`
        );
      }
    } catch (error) {
      console.log("Error in cron job", error);
      logger.error("Error in cron job", error);
    }
  });

  // cron.schedule("* * * * *", async () => {
  //   try {
  //     // console.log(`Running cron job at ${new Date().toISOString()}`);
  //     const now = new Date(); // current time in UTC
  //     const endNow = DateTime.utc().startOf("minute"); // e.g., 13:42:00

  //     const data = await Bookings.find({
  //       startDateTime: { $gt: now },
  //       cancelled: false,
  //       // _id: "68924c90795dd1d2abaee90a",
  //     })
  //       .populate("teacherId")
  //       .populate("UserId")
  //       .populate("LessonId")
  //       .populate("zoom")
  //       .sort({ startDateTime: 1 });
  //     // console.log("data",data);

  //     const registrationSubject = "Reminder for Booking ⏰";

  //     for (const booking of data) {
  //       const objectId = new mongoose.Types.ObjectId(booking?.teacherId?._id);
  //       const teacherData = await Teacher.findOne({ userId: objectId });
  //       // console.log("TeacherData",teacherData);
  //       const nowTime = DateTime.utc();
  //       const startUTC = DateTime.fromJSDate(booking.startDateTime).toUTC();
  //       const diffInMinutes = Math.round(
  //         startUTC.diff(nowTime, "minutes").minutes
  //       );
  //       // console.log("startUTC",startUTC);
  //       // console.log("nowTime",nowTime);
  //       // console.log("diffInMinutes",diffInMinutes);
  //       let time = null;
  //       // if (diffInMinutes === 1440) time = "24 hours";
  //       // else if (diffInMinutes === 120) time = "2 hours";
  //       // else if (diffInMinutes === 30) time = "30 minutes";
  //       if (diffInMinutes === 30) time = "30 minutes";
  //       // else if (diffInMinutes === 5) time = "5 minutes";
  //       else continue; // skip if not one of the 4 target intervals
  //       let zoomLink = null;

  //       // Zoom Code
  //       if (diffInMinutes < 30 && !booking.zoom){
  //         console.log(`Creating Zoom meeting for booking ID: ${booking._id}`);
  //         logger.info(`Creating Zoom meeting for booking ID: ${booking._id}`);

  //         // Generate a safe random password (>= 8 alphanumeric chars)
  //         const generatedPassword = Math.random().toString(36).slice(-8);
  //         const meetingDetails = {
  //           topic: booking?.LessonId?.title || "Lesson booking",
  //           type: 2, // Scheduled meeting
  //           start_time: booking.startDateTime.toISOString(),
  //           duration: booking?.LessonId?.duration || 60,
  //           password: generatedPassword,
  //           timezone: "UTC",
  //           settings: {
  //             auto_recording: "cloud",
  //             host_video: true,
  //             participant_video: true,
  //             mute_upon_entry: true,
  //             join_before_host: true,
  //             waiting_room: false,
  //           },
  //         };
  //         // const result = await createZoomMeeting(meetingDetails);
  //         const result = await createZoomMeeting(
  //           meetingDetails,
  //           teacherData,
  //           Teacher
  //         );
  //         if (!result?.meeting_id) {
  //           logger.error(
  //             `❌ Failed to create meeting for booking ${booking._id}`
  //           );
  //           continue; // skip email sending if meeting wasn't created
  //         }
  //         zoomLink = result?.meeting_url || "";
  //         // console.log("result",result);
  //         logger.info(
  //           "Meeting link generated successfully with",
  //           result?.meeting_id
  //         );
  //         // console.log("Sending email for booking",booking._id);
  //         const zoomRecord = new Zoom({
  //           meetingId: result?.meeting_id || "",
  //           meetingLink: result?.meeting_url || "",
  //         });
  //         const zoomResult = await zoomRecord.save();
  //         booking.zoom = zoomResult._id; // Save the Zoom meeting ID in the booking
  //         await booking.save();
  //       }
  //       logger.info("Sending email for booking", booking._id);
  //       // console.log("Sending email for booking",booking._id);
  //       // continue;

  //       const user = booking?.UserId;
  //       const teacher = booking?.teacherId;
  //       const lesson = booking?.LessonId;

  //       const userName = user?.name || "";
  //       const teacherName = teacher?.name || "";
  //       const lessonName = lesson?.title || "";

  //       // Sending email to student
  //       const emailHtml = Reminder(
  //         userName,
  //         zoomLink ||
  //           booking.zoom?.meetingLink ||
  //           "https://akitainakaschoolonline.com/student/lessons",
  //         time,
  //         teacherName,
  //         lessonName
  //       );

  //       await sendEmail({
  //         email: user.email,
  //         subject: registrationSubject,
  //         emailHtml: emailHtml,
  //       });

  //       logger.info(`📧 Reminder email sent to user ${user.email}`);

  //       // Sending email to teacher
  //       const TeacherEmailHtml = TeacherReminder(
  //         userName,
  //         zoomLink ||
  //           booking.zoom?.meetingLink ||
  //           "https://akitainakaschoolonline.com/teacher-dashboard/booking",
  //         time,
  //         teacherName,
  //         lessonName
  //       );

  //       await sendEmail({
  //         email: teacher.email,
  //         subject: registrationSubject,
  //         emailHtml: TeacherEmailHtml,
  //       });

  //       logger.info(`📧 Reminder email sent to teacher ${teacher.email}`);
  //     }

  //     // Sending lesson done emails to user and teacher
  //     const justEndedBookings = await Bookings.find({
  //       cancelled: false,
  //       endDateTime: {
  //         $gte: endNow.toJSDate(),
  //         $lt: endNow.plus({ minutes: 1 }).toJSDate(), // match to current minute
  //       },
  //       // "_id": "686271edc0b8706b75e81101",
  //     })
  //       .populate("teacherId")
  //       .populate("UserId")
  //       .populate("LessonId");

  //     // console.log("justEndedBookings",justEndedBookings);
  //     for (const booking of justEndedBookings) {
  //       const user = booking?.UserId;
  //       const teacher = booking?.teacherId;

  //       const userName = user?.name || "";
  //       const teacherName = teacher?.name || "";

  //       // const token = jwt.sign(
  //       //   { BookingId: booking._id, UserId: booking?.UserId },
  //       //   process.env.JWT_SECRET_KEY,
  //       //   { expiresIn: process.env.JWT_EXPIRES_IN || "365d" }
  //       // );

  //       // const studentDoneEmailHtml = StudentLessonDone(
  //       //   userName,
  //       //   teacherName,
  //       //   `https://akitainakaschoolonline.com/confirm-lesson/${token}`
  //       // );

  //       // await sendEmail({
  //       //   email: user.email,
  //       //   subject: "Please confirm your lesson completion ✅",
  //       //   emailHtml: studentDoneEmailHtml,
  //       // });

  //       // logger.info(`📧 StudentLessonDone email sent to ${user.email} for booking ${booking._id}`);
  //       // console.log(`📧 StudentLessonDone email sent to ${user.email} for booking ${booking._id}`);

  //       // Lesson done email to teacher
  //       const teacherToken = jwt.sign(
  //         { BookingId: booking._id, teacherId: booking?.teacherId },
  //         process.env.JWT_SECRET_KEY,
  //         { expiresIn: process.env.JWT_EXPIRES_IN || "365d" }
  //       );

  //       const teacherDoneEmailHtml = TeacherLessonDone(
  //         userName,
  //         teacherName,
  //         `https://akitainakaschoolonline.com/confirm-lesson/${teacherToken}`
  //       );

  //       await sendEmail({
  //         email: teacher.email,
  //         subject: "Please confirm your lesson completion ✅",
  //         emailHtml: teacherDoneEmailHtml,
  //       });

  //       logger.info(
  //         `📧 TeacherLessonDone email sent to ${teacher.email} for booking ${booking._id}`
  //       );
  //       console.log(
  //         `📧 TeacherLessonDone email sent to ${teacher.email} for booking ${booking._id}`
  //       );
  //     }
  //   } catch (error) {
  //     console.log("Error in cron job", error);
  //     logger.error("Error in cron job", error);
  //   }
  // });

  // Cleanup old availability - daily at 1 AM
  cron.schedule("0 1 * * *", async () => {
    try {
      console.log(
        `🕐 Running availability cleanup at ${new Date().toISOString()}`
      );
      const nowUtc = new Date();
      const yesterdayEndUtc = new Date(
        Date.UTC(
          nowUtc.getUTCFullYear(),
          nowUtc.getUTCMonth(),
          nowUtc.getUTCDate() - 1,
          23,
          59,
          59,
          999
        )
      );

      const result = await TeacherAvailability.deleteMany({
        startDateTime: { $lte: yesterdayEndUtc },
        endDateTime: { $lte: yesterdayEndUtc },
      });
      console.log(
        `✅ Deleted ${result.deletedCount} outdated availability entries.`
      );
    } catch (error) {
      console.error("❌ Error in availability cleanup cron job:", error);
    }
  });

  cron.schedule('0 6,18 * * *', async () => {
    try {
      console.log('⏰ Currency update cron job triggered!');
      const emailHtml = currency('Success', true, '', 'May 29, 2025 11:25 AM');
      const record = await updateCurrencyRatesJob();
      await sendEmail({
        email: "ankit.jain@internetbusinesssolutionsindia.com",
        subject: 'Currency Rate Update - Success',
        emailHtml: emailHtml,
      });
    } catch (err) {
      console.error('❌ Cron job error:', err);
    }
  });

  cron.schedule("* * * * *", async () => {
    try {
      // console.log("Running message cron");
      const EMAIL_DELAY_MINUTES = 5;
      const cutoffTime = new Date(Date.now() - EMAIL_DELAY_MINUTES * 60 * 1000);
      const unreadMessages = await Message.find({
        is_read: false,
        is_deleted: false,
        email_notified: false,
        notification_locked: false,
        createdAt: { $lte: cutoffTime },
      })
        .sort({ createdAt: 1 })
        .populate("student teacher");

      // console.log("unreadMessages", unreadMessages);

      const pairs = {};
      for (const msg of unreadMessages) {
        const key = `${msg.student._id}_${msg.teacher._id}`;
        if (!pairs[key]) {
          pairs[key] = msg;
        }
      }
      for (const key in pairs) {
        const msg = pairs[key];
        const receiver = msg.sent_by === "student" ? msg.teacher : msg.student;
        const sender = msg.sent_by === "student" ? msg.student : msg.teacher;
        if (!receiver?.email) continue;
        const link =
          sender.role === "teacher"
            ? "https://akitainakaschoolonline.com/student/message"
            : "https://akitainakaschoolonline.com/teacher-dashboard/message";
        await sendEmail({
          email: receiver.email,
          subject: `New message from ${sender.name}`,
          emailHtml: MessageTemplate(
            receiver.name || "",
            sender.name || "",
            link
          ),
        });

        logger.info(
          `📧 Message notification email sent to ${receiver.email} for unread message from ${sender?.email}`
        );

        // 4️⃣ LOCK THE CONVERSATION
        await Message.updateMany(
          {
            student: msg.student._id,
            teacher: msg.teacher._id,
            is_read: false,
          },
          {
            email_notified: true,
            notification_locked: true,
          }
        );
      }
    } catch (error) {
      logger.error("Error in message email cron", error);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    // cron.schedule("* * * * *", async () => {
    // logger.info("⏳ Running Google Calendar sync cron");
    const now = new Date();
    // console.log("now", now);
    const bookings = await Bookings.find({
      startDateTime: { $gt: now },
      calendarSynced: false,
      cancelled: false,
    })
    .populate("UserId")
    .populate("LessonId")
    .limit(20)
    .sort({startDateTime: 1})
    .lean(false);

    // console.log("bookings", bookings);

    for (const booking of bookings) {
      try {
        // 1️⃣ Find teacher using booking.teacherId (User ID)
        const teacher = await Teacher.findOne({ userId: booking.teacherId });
        const user = await User.findById(booking.teacherId);
        if (!teacher?.googleCalendar?.connected) {
          logger.warn(`Calendar not connected for teacher ${booking.teacherId}`);
          continue;
        }
        // 2️⃣ Get valid Google Calendar client
        const calendar = await getValidGoogleClient(teacher);
        // 3️⃣ Create calendar event using booking data
        const event = {
          summary: `${booking.LessonId.title || ""} Lesson with ${booking.UserId.name || ""}`,
          description: `Lesson booking\nBooking ID: ${booking._id || ""}`,
          start: {
            dateTime: booking.startDateTime.toISOString(),
            timeZone: user.time_zone || "UTC",
          },
          end: {
            dateTime: booking.endDateTime.toISOString(),
            timeZone: user.time_zone || "UTC",
          },
          extendedProperties: {
            private: {
              source: "AkitaInakaSchoolOnline",
              bookingId: booking._id.toString(),
              teacherId: teacher._id.toString(),
            },
          },
        };
        // 4️⃣ Insert event
        const response = await calendar.events.insert({
          calendarId: teacher.googleCalendar.calendarId || "primary",
          requestBody: event,
        });
        // 5️⃣ Update booking
        booking.calendarSynced = true;
        booking.calendarEventId = response.data.id;
        await booking.save();
        logger.info(`✅ Calendar synced for booking ${booking._id}`);
      } catch (err) {
        logger.error(`❌ Calendar sync failed for booking ${booking._id}`,err);
      }
    }
  });
};