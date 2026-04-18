const Bookings = require("../model/booking");
const User = require("../model/user");
const { errorResponse, successResponse } = require("../utils/ErrorHandling");
const catchAsync = require("../utils/catchAsync");
const StudentCancel = require("../EmailTemplate/Cancelled");
const AdminCancel = require("../EmailTemplate/AdminCancel");
const Reschedule = require("../EmailTemplate/Reschedule");
const { DateTime } = require("luxon");
const sendEmail = require("../utils/EmailMailler");
const BulkLesson = require("../model/bulkLesson");
const Teacher = require("../model/teacher");
const { getValidGoogleClient } = require("../utils/GoogleCalendar");
const logger = require("../utils/Logger");

exports.AddBooking = catchAsync(async (req, res) => {
  try {
    const { startDateTime, endDateTime, teacher_id, lesson_id } = req.body;

    if ((!startDateTime, !endDateTime, !teacher_id || !lesson_id)) {
      return errorResponse(
        res,
        "Teacher ID, Lesson ID, and time are required",
        400,
      );
    }

    const booking = await Bookings.create({
      teacher: teacher_id,
      startDateTime,
      endDateTime,
      lesson: lesson_id,
      student: req.user._id,
    });

    return successResponse(res, "Booking added successfully", 201, booking);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateBooking = catchAsync(async (req, res) => {
  try {
    const {
      lessonCompletedStudent,
      lessonCompletedTeacher,
      startDateTime,
      endDateTime,
      timezone,
    } = req.body;
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "Booking ID is required", 400);
    }
    const booking = await Bookings.findById(id)
      .populate("teacherId")
      .populate("UserId")
      .populate("LessonId");
    if (!booking) {
      return errorResponse(res, "Booking not found", 404);
    }
    if (lessonCompletedStudent != null) {
      booking.lessonCompletedStudent = lessonCompletedStudent;
    }
    if (lessonCompletedTeacher != null) {
      booking.lessonCompletedTeacher = lessonCompletedTeacher;
    }

    let oldStartTime = booking.startDateTime;
    const oldStartUTC = DateTime.fromJSDate(oldStartTime, { zone: "utc" });

    let timeUpdated = false;
    if (startDateTime && endDateTime) {
      // if (booking.rescheduled) {
      //   return errorResponse(res, "Booking has already been rescheduled once", 400);
      // }

      if (!timezone) {
        return errorResponse(
          res,
          "Timezone is required when updating time",
          400,
        );
      }

      logger.info(
        `Rescheduling booking ${booking._id} from ${booking.startDateTime} to ${startDateTime} (${timezone})`,
      );

      const startUTC = DateTime.fromISO(startDateTime, {
        zone: timezone,
      })
        .toUTC()
        .toJSDate();

      const endUTC = DateTime.fromISO(endDateTime, {
        zone: timezone,
      })
        .toUTC()
        .toJSDate();
      
      const startUTCObj = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC(); 
      const tenMinutesFromNow = DateTime.utc().plus({ minutes: 10 });
      if (startUTCObj < tenMinutesFromNow) {
        return errorResponse(res, "Start time must be at least 10 minutes from now", 400);
      }

      booking.rescheduleHistory.push({
        before: booking.startDateTime,
        after: startUTC,
        oldZoom: booking.zoom ? booking.zoom : null,
      });

      booking.startDateTime = startUTC;
      booking.endDateTime = endUTC;
      booking.rescheduled = true;
      booking.zoom = null;
      timeUpdated = true;
    }

    await booking.save();

    // Sending booking emails
    if (timeUpdated) {
      const subject = "Booking Rescheduled";

      const utcDateTime = DateTime.fromJSDate(booking.startDateTime, {
        zone: "utc",
      });

      const userTimeISO = booking?.UserId?.time_zone
        ? utcDateTime.setZone(booking.UserId.time_zone).toISO()
        : utcDateTime.toISO();

      const userOldStartTimeISO = booking?.UserId?.time_zone
        ? oldStartUTC.setZone(booking.UserId.time_zone).toISO()
        : oldStartUTC.toISO();

      const teacherTimeISO = booking?.teacherId?.time_zone
        ? utcDateTime.setZone(booking.teacherId.time_zone).toISO()
        : utcDateTime.toISO();

      const teacherOldStartTimeISO = booking?.teacherId?.time_zone
        ? oldStartUTC.setZone(booking.teacherId.time_zone).toISO()
        : oldStartUTC.toISO();

      // Email to Student
      const emailHtml = Reschedule(
        booking?.UserId?.name,
        booking?.teacherId?.name,
        userTimeISO,
        userOldStartTimeISO,
        "https://akitainakaschoolonline.com/student/lessons",
      );
      logger.info(
        `Booking reschedule email sending to student at  ${booking?.UserId?.email}`,
      );
      await sendEmail({
        email: booking?.UserId?.email,
        subject: subject,
        emailHtml: emailHtml,
      });

      // Email to teacher
      const teacherEmailHtml = Reschedule(
        booking?.teacherId?.name,
        booking?.UserId?.name,
        teacherTimeISO,
        teacherOldStartTimeISO,
        "https://akitainakaschoolonline.com/teacher-dashboard/booking",
      );
      logger.info(
        `Booking reschedule email sending to teacher at  ${booking?.teacherId?.email}`,
      );
      await sendEmail({
        email: booking?.teacherId?.email,
        subject: subject,
        emailHtml: teacherEmailHtml,
      });
    }

    // Update Google Calendar event if time was changed
    if (timeUpdated && booking.calendarSynced && booking.calendarEventId) {
      try {
        const teacher = await Teacher.findOne({
          userId: booking.teacherId._id,
        });
        const user = await User.findById(booking.teacherId._id);

        if (teacher?.googleCalendar?.connected) {
          const calendar = await getValidGoogleClient(teacher);
          await calendar.events.patch({
            calendarId: teacher.googleCalendar.calendarId || "primary",
            eventId: booking.calendarEventId,
            requestBody: {
              start: {
                dateTime: booking.startDateTime.toISOString(),
                timeZone: user.time_zone || "UTC",
              },
              end: {
                dateTime: booking.endDateTime.toISOString(),
                timeZone: user.time_zone || "UTC",
              },
            },
          });
          logger.info(`🔄 Calendar updated for booking ${booking._id}`);
        }
      } catch (err) {
        logger.error(
          `Failed to update calendar for booking ${booking._id}`,
          err,
        );
      }
    }

    return successResponse(res, "Booking updated successfully", 200);
  } catch (error) {
    console.log("Error in UpdateBooking:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetBookings = catchAsync(async (req, res) => {
  try {
    const { role, id } = req.user;

    let data;
    data = await Bookings.find({ UserId: id })
      .populate("teacherId")
      .populate("UserId")
      .populate("LessonId")
      .populate("StripepaymentId")
      .populate("paypalpaymentId")
      .populate("zoom")
      .sort({ startDateTime: 1 });

    if (!data || data.length === 0) {
      return errorResponse(res, "No bookings found", 200);
    }

    const dedupedMap = new Map();
    for (const booking of data) {
      const key = [
        String(booking?.teacherId?._id || booking?.teacherId || ""),
        String(booking?.LessonId?._id || booking?.LessonId || ""),
        new Date(booking.startDateTime).toISOString(),
        new Date(booking.endDateTime).toISOString(),
      ].join("|");

      const existing = dedupedMap.get(key);
      if (!existing) {
        dedupedMap.set(key, booking);
        continue;
      }

      const existingHasZoom = Boolean(existing?.zoom?._id || existing?.zoom);
      const currentHasZoom = Boolean(booking?.zoom?._id || booking?.zoom);
      if (!existingHasZoom && currentHasZoom) {
        dedupedMap.set(key, booking);
        continue;
      }

      const existingCreatedAt = existing?.createdAt
        ? new Date(existing.createdAt).getTime()
        : 0;
      const currentCreatedAt = booking?.createdAt
        ? new Date(booking.createdAt).getTime()
        : 0;
      if (currentCreatedAt > existingCreatedAt) {
        dedupedMap.set(key, booking);
      }
    }

    data = Array.from(dedupedMap.values()).sort(
      (a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
    );

    return successResponse(res, "Bookings retrieved successfully", 200, data);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.CancelBooking = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "Booking ID is required", 400);
    }
    const booking = await Bookings.findById(id)
      .populate("UserId")
      .populate("UserId")
      .populate("teacherId");

    if (!booking) {
      return errorResponse(res, "Booking not found", 404);
    }
    if (booking.cancelled) {
      return successResponse(res, "Booking is already cancelled", 200);
    }
    booking.cancelled = true;
    await booking.save();

    if (booking.calendarSynced && booking.calendarEventId) {
      try {
        const teacher = await Teacher.findOne({
          userId: booking.teacherId._id,
        });

        if (teacher?.googleCalendar?.connected) {
          const calendar = await getValidGoogleClient(teacher);
          await calendar.events.delete({
            calendarId: teacher.googleCalendar.calendarId || "primary",
            eventId: booking.calendarEventId,
          });
          logger.info(`Calendar event deleted for booking ${booking._id}`);
        }
      } catch (err) {
        logger.error(
          `Failed to delete calendar event for booking ${booking._id}`,
          err,
        );
      }
    }

    // --- Update BulkLesson record ---
    await BulkLesson.findOneAndUpdate(
      { "bookings.id": booking._id },
      {
        $set: { "bookings.$.cancelled": true },
        $inc: { lessonsRemaining: 1 },
      },
    );

    const admin = await User.findOne({ role: "admin" });
    // console.log("admin", admin);

    // Convert to ISO format for moment parsing in email templates
    const utcDateTime = DateTime.fromJSDate(new Date(booking?.startDateTime), {
      zone: "utc",
    });

    const studentTimeISO = booking?.UserId?.time_zone
      ? utcDateTime.setZone(booking?.UserId?.time_zone).toISO()
      : utcDateTime.toISO();

    const adminTimeISO = admin?.time_zone
      ? utcDateTime.setZone(admin.time_zone).toISO()
      : utcDateTime.toISO();

    // console.log("studentTimeISO", studentTimeISO);
    // console.log("adminTimeISO", adminTimeISO);

    // Send email logic for student
    const studentSubject = `Your Lesson with ${booking?.teacherId?.name} Has Been Cancelled`;
    const emailHtml = StudentCancel(
      booking?.UserId?.name,
      booking?.teacherId?.name,
      studentTimeISO,
    );
    await sendEmail({
      email: booking?.UserId?.email,
      subject: studentSubject,
      emailHtml: emailHtml,
    });

    // Send email logic for admin
    const adminSubject = `Lesson Cancelled by ${booking?.teacherId?.name}`;
    const adminHtml = AdminCancel(
      booking?.UserId?.name,
      booking?.teacherId?.name,
      adminTimeISO,
    );
    await sendEmail({
      email: "winniedk@gmail.com",
      subject: adminSubject,
      emailHtml: adminHtml,
    });

    return successResponse(res, "Booking cancelled successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});
