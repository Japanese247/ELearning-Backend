const TeacherAvailability = require("../model/TeacherAvailability");
const Bookings = require("../model/booking");
const Lesson = require("../model/lesson");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse, validationErrorResponse } = require("../utils/ErrorHandling");
const { DateTime } = require("luxon");
const logger = require("../utils/Logger");
const { uploadFileToSpaces, deleteFileFromSpaces } = require("../utils/FileUploader");
const User = require("../model/user");
const Teacher = require("../model/teacher");
const SpecialSlot = require("../model/SpecialSlot");
const Review = require("../model/review");
const mongoose = require('mongoose');
const sendEmail = require("../utils/EmailMailler");
const SpecialSlotEmail = require("../EmailTemplate/SpecialSlot");
const jwt = require("jsonwebtoken");

exports.AddAvailability = catchAsync(async (req, res) => {
  try {
    let { startDateTime, endDateTime } = req.body;
    const time_zone = req.user.time_zone;

    if (!startDateTime || !endDateTime) {
      return errorResponse(res, "Start time and End time are required", 400);
    }

    // Convert input to UTC
    let startUTC = DateTime.fromISO(startDateTime, { zone: time_zone }).toUTC().toJSDate();
    let endUTC = DateTime.fromISO(endDateTime, { zone: time_zone }).toUTC().toJSDate();

    if (startUTC >= endUTC) {
      return errorResponse(res, "End time must be after start time", 400);
    }
    const existingAvailabilities = await TeacherAvailability.find({ teacher: req.user.id });
    const hasOverlap = existingAvailabilities.some(avail => {
      return startUTC < avail.endDateTime && endUTC > avail.startDateTime;
    });
    if (hasOverlap) {
      return errorResponse(res, "Availability overlaps with existing schedule", 400);
    }
    const adjacents = existingAvailabilities.filter(avail =>
      avail.endDateTime.getTime() === startUTC.getTime() ||
      avail.startDateTime.getTime() === endUTC.getTime()
    );
    if (adjacents.length > 0) {
      for (const avail of adjacents) {
        startUTC = new Date(Math.min(startUTC.getTime(), avail.startDateTime.getTime()));
        endUTC = new Date(Math.max(endUTC.getTime(), avail.endDateTime.getTime()));
      }
      const adjacentIds = adjacents.map(a => a._id);
      await TeacherAvailability.deleteMany({ _id: { $in: adjacentIds } });
    }
    const booking = await TeacherAvailability.create({
      teacher: req.user.id,
      startDateTime: startUTC,
      endDateTime: endUTC,
    });
    return successResponse(res, "Availability added successfully", 201, booking);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateAvailability = catchAsync(async (req, res) => {
  try {
    const { startDateTime, endDateTime } = req.body;
    const { id } = req.params;
    const time_zone = req.user.time_zone;

    if (!id) {
      return errorResponse(res, "ID is required", 400);
    }

    const data = await TeacherAvailability.findById(id);
    if (!data) {
      return errorResponse(res, "Invalid Id. No data found", 404);
    }

    if (startDateTime != null) {
      data.startDateTime = DateTime.fromISO(startDateTime, { zone: time_zone }).toUTC().toJSDate();
    }

    if (endDateTime != null) {
      data.endDateTime = DateTime.fromISO(endDateTime, { zone: time_zone }).toUTC().toJSDate();
    }

    await data.save();
    return successResponse(res, "Availability updated successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.RemoveAvailability = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return errorResponse(res, "ID is required", 400);
    }

    const availability = await TeacherAvailability.findOneAndDelete({ _id: id });

    if (!availability) {
      return errorResponse(res, "Invalid Id. No data found", 404);
    }

    return successResponse(res, "Availability removed successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetAvailability = catchAsync(async (req, res) => {
  try {
    const id = req.user.id;
    const availabilityBlocks = await TeacherAvailability.find({ teacher: id });
    if (!availabilityBlocks || availabilityBlocks.length === 0) {
      return errorResponse(res, "No Data found", 200);
    }

    const bookings = await Bookings.find({ teacherId: id, cancelled: false }).lean();

    if (!bookings || bookings.length === 0) {
      return successResponse(res, "Availability processed", 200, {
        availabilityBlocks,
        bookedSlots: [],
      });
    }

    let availableSlots = [];
    let bookedSlots = [];

    for (const availability of availabilityBlocks) {
      const aStart = new Date(availability.startDateTime);
      const aEnd = new Date(availability.endDateTime);

      const matchingBookings = bookings.filter(booking =>
        new Date(booking.endDateTime) > aStart && new Date(booking.startDateTime) < aEnd
      );

      matchingBookings.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));

      // No overlapping bookings, push as-is (preserve _id)
      if (matchingBookings.length === 0) {
        availableSlots.push({
          _id: availability._id, // preserve
          teacher: id,
          startDateTime: aStart,
          endDateTime: aEnd,
        });
        continue;
      }

      let cursor = aStart;

      for (const booking of matchingBookings) {
        const bStart = new Date(booking.startDateTime);
        const bEnd = new Date(booking.endDateTime);

        if (cursor < bStart) {
          availableSlots.push({
            teacher: id,
            startDateTime: new Date(cursor),
            endDateTime: new Date(bStart),
            // no _id since this is a derived block
          });
        }

        // Move cursor 5 minutes ahead of booking end
        const nextStart = new Date(bEnd.getTime() + 5 * 60000);
        cursor = nextStart > cursor ? nextStart : cursor;
      }

      if (cursor < aEnd) {
        availableSlots.push({
          teacher: id,
          startDateTime: new Date(cursor),
          endDateTime: new Date(aEnd),
          // no _id since this is a derived block
        });
      }

      bookedSlots.push(
        ...matchingBookings.map(b => ({
          teacher: id,
          startDateTime: new Date(b.startDateTime),
          endDateTime: new Date(b.endDateTime),
          student: b.student,
          lesson: b.lesson,
        }))
      );
    }

    return successResponse(res, "Availability processed", 200, {
      availabilityBlocks: availableSlots,
      bookedSlots,
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

// This route is used when teacher want to get all the lessons in their panel
exports.GetLessons = catchAsync(async (req, res) => {
  try {
    const teacherId = req.user.id;
    const profile = await Teacher.findOne({ userId: teacherId }).populate("userId");
    const lessons = await Lesson.find({ teacher: teacherId }).populate("teacher");
    if (!lessons || lessons.length === 0) {
      return errorResponse(res, "No lessons found", 404);
    }
    return successResponse(res, "Lessons retrieved successfully", 200, {
      profile,
      lessons
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UploadCheck = catchAsync(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(500).json({ error: 'File toh bhej bhai' });
    }
    const fileKey = await uploadFileToSpaces(req.file);
    if (fileKey) {
      res.status(200).json({ fileKey });
    } else {
      res.status(500).json({ error: 'Upload failed' });
    }
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.DeleteCheck = catchAsync(async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Please provide url"
      })
    }
    const isDeleted = await deleteFileFromSpaces(url);
    if (!isDeleted) {
      return res.status(500).json({
        status: false,
        message: "Unable to delete file"
      })
    }
    res.status(200).json({
      status: false,
      message: "File deleted successfully!"
    })
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.TeacherGet = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return errorResponse(res, "No user Id provided", 401);
    }
    const user = await Teacher.findOne({ userId: userId }).populate("userId");
    if (!user) {
      return errorResponse(res, "Teacher not Found", 401);
    }
    if (user) {
      return successResponse(res, "User Get successfully!", 201, {
        user,
      });
    }
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.updateProfile = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const files = req.files || {};
    // console.log("files",files);
    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }

    const {
      name,
      email,
      timezone,
      nationality,
      // profile_photo,
      languages_spoken,
      gender,
      ais_trained,
      intro_video,
      interest,
      experience,
      description,
      // average_price,
      // average_time,
      qualifications,
      tags,
      // documentlink,
    } = req.body;

    const userUpdates = {};
    const teacherUpdates = {};

    const user = await User.findById(userId);
    const teacher = await Teacher.findOne({ userId });
    if (!user || !teacher) {
      return errorResponse(res, "User not found", 404);
    }
    let profile_photo = null;
    if (files.profile_photo?.[0]) {
      if (user?.profile_photo) {
        // console.log("Old profile photo to delete:", user.profile_photo);
        const isDeleted = await deleteFileFromSpaces(user.profile_photo);
        if (!isDeleted) {
          return res.status(500).json({
            status: false,
            message: "Unable to delete old profile photo",
          });
        }
      }
      const fileKey = await uploadFileToSpaces(files.profile_photo?.[0]);
      profile_photo = fileKey;
    }

    // if (profile_photo) {
    //   userUpdates.profile_photo = profile_photo;
    // }

    let documentlink = null;
    if (files.documentlink?.[0]) {
      if (teacher?.documentlink) {
        // console.log("Old profile photo to delete:", user.profile_photo);
        const isDeleted = await deleteFileFromSpaces(teacher.documentlink);
        if (!isDeleted) {
          return res.status(500).json({
            status: false,
            message: "Unable to delete old document",
          });
        }
      }
      const fileKey = await uploadFileToSpaces(files.documentlink?.[0]);
      documentlink = fileKey;
    }

    // if (documentlink) {
    //   teacherUpdates.documentlink = documentlink;
    // }

    // Explicit field mapping
    if (name !== undefined) userUpdates.name = name;
    if (email !== undefined) userUpdates.email = email;
    if (timezone !== undefined) userUpdates.time_zone = timezone;
    if (nationality !== undefined) userUpdates.nationality = nationality;
    if (profile_photo !== undefined && profile_photo !== null && profile_photo !== "") {
      userUpdates.profile_photo = profile_photo;
    }

    if (languages_spoken !== undefined) teacherUpdates.languages_spoken = JSON.parse(languages_spoken);
    if (gender !== undefined) teacherUpdates.gender = gender;
    if (ais_trained !== undefined) teacherUpdates.ais_trained = ais_trained;
    if (intro_video !== undefined) teacherUpdates.intro_video = intro_video;
    if (interest !== undefined) teacherUpdates.interest = interest;
    if (experience !== undefined) teacherUpdates.experience = experience;
    if (description !== undefined) teacherUpdates.description = description;
    // if (average_price !== undefined) teacherUpdates.average_price = average_price;
    // if (average_time !== undefined) teacherUpdates.average_time = average_time;
    if (tags !== undefined) teacherUpdates.tags = JSON.parse(tags);
    if (qualifications !== undefined) teacherUpdates.qualifications = qualifications;
    if (documentlink !== undefined && documentlink !== null && documentlink !== "") {
      teacherUpdates.documentlink = documentlink;
    }

    const isUserUpdateEmpty = Object.keys(userUpdates).length === 0;
    const isTeacherUpdateEmpty = Object.keys(teacherUpdates).length === 0;

    if (isUserUpdateEmpty && isTeacherUpdateEmpty) {
      return errorResponse(res, "No fields provided to update", 400);
    }

    const updatedUser = isUserUpdateEmpty
      ? await User.findById(userId)
      : await User.findByIdAndUpdate(userId, userUpdates, {
        new: true,
        runValidators: true,
      });

    // Update Teacher
    const updatedTeacher = isTeacherUpdateEmpty
      ? await Teacher.findOne({ userId })
      : await Teacher.findOneAndUpdate({ userId }, teacherUpdates, {
        new: true,
        runValidators: true,
      });

    return successResponse(res, "Profile updated successfully!", 200, {
      user: updatedUser,
      teacher: updatedTeacher,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.EarningsGet = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    // console.log("req.query",req.query);
    const { date, search } = req.query;
    // console.log("search",search);

    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }
    const objectId = new mongoose.Types.ObjectId(userId);
    const filter = {
      teacherId: objectId,
      lessonCompletedStudent: true,
      lessonCompletedTeacher: true,
    };

    if (date) {
      const now = new Date();

      if (date === "last7") {
        const from = new Date();
        from.setDate(now.getDate() - 7);
        filter.startDateTime = { $gte: from, $lte: now };

      } else if (date === "last30") {
        const from = new Date();
        from.setDate(now.getDate() - 30);
        filter.startDateTime = { $gte: from, $lte: now };

      } else if (!isNaN(date)) {
        // If it's a year like "2024"
        const year = parseInt(date, 10);
        const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
        const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);
        filter.startDateTime = { $gte: startOfYear, $lte: endOfYear };
      }
    }

    // Get detailed booking data
    let data = await Bookings.find(filter)
      .sort({ startDateTime: -1 })
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('UserId')
      .populate('LessonId');

    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i"); // case-insensitive match

      data = data.filter((item) => {
        const lessonTitle = item.LessonId?.title || "";
        const stripeId = item.StripepaymentId?.payment_id || "";
        const paypalId = item.paypalpaymentId?.orderID || "";

        return (
          regex.test(lessonTitle) ||
          regex.test(stripeId) ||
          regex.test(paypalId)
        );
      });
    }

    if (!data) {
      return errorResponse(res, "Data not Found", 401);
    }

    // Aggregate the earnings
    const earnings = await Bookings.aggregate([
      // { $match: { teacherId: objectId, lessonCompletedStudent: true, lessonCompletedTeacher: true } },
      { $match: filter },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$teacherEarning" },
          pendingEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$payoutCreationDate", null] },
                "$teacherEarning",
                0
              ]
            }
          },
          requestedEarnings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$payoutCreationDate", null] },
                    { $eq: ["$payoutDoneAt", null] }
                  ]
                },
                "$teacherEarning",
                0
              ]
            }
          },
          approvedEarnings: {
            $sum: {
              $cond: [
                { $ne: ["$payoutDoneAt", null] },
                "$teacherEarning",
                0
              ]
            }
          }
        }
      }
    ]);

    const earningsSummary = earnings[0] || {
      totalEarnings: 0,
      pendingEarnings: 0,
      approvedEarnings: 0
    };

    successResponse(res, "User Get successfully!", 200, {
      bookings: data,
      earningsSummary
    });
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.BookingsGet = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }

    const filter = { teacherId: userId };
    const sort = {};
    const { type, search } = req.query;
    const now = Date.now();
    if (type === "upcoming") {
      filter.startDateTime = { $gt: now };
      sort.startDateTime = 1;
    } else if (type === "past") {
      filter.startDateTime = { $lte: now };
      sort.startDateTime = -1;
    }

    // Get detailed booking data
    let data = await Bookings.find(filter).sort(sort)
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('UserId')
      .populate('LessonId')
      .populate('zoom');

    // Apply search filter on populated fields
    if (search?.trim()) {
      const regex = new RegExp(search.trim(), "i");
      data = data.filter((item) => {
        const lessonTitle = item?.LessonId?.title || "";
        const studentName = item?.UserId?.name || "";
        return regex.test(lessonTitle) || regex.test(studentName);
      });
    }

    if (!data || data.length === 0) {
      return errorResponse(res, "No bookings found", 404);
    }

    return successResponse(res, "Bookings retrieved successfully!", 200, data);
  } catch (error) {
    console.error(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});


exports.DashboardApi = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);
    const TeacherData = await Lesson.findOne({
      teacher: userId,
      is_deleted: false,
    }).sort({ price: 1 });

    // console.log("objectId",objectId);

    const Reviews = await Review.find({}).populate("lessonId");
    const ReviewesCount = Reviews.filter(
      review => review?.lessonId?.teacher?.toString() === objectId.toString()
    ).length;

    const result = await Bookings.aggregate([
      {
        $match: {
          lessonCompletedStudent: true,
          lessonCompletedTeacher: true,
          teacherId: objectId
        }
      },
      {
        $lookup: {
          from: 'lessons',
          localField: 'LessonId',
          foreignField: '_id',
          as: 'lesson'
        }
      },
      {
        $unwind: '$lesson'
      },
      {
        $addFields: {
          durationCategory: {
            $switch: {
              branches: [
                { case: { $eq: ['$lesson.duration', 30] }, then: 'duration30' },
                { case: { $eq: ['$lesson.duration', 50] }, then: 'duration50' }
              ],
              default: 'durationOther'
            }
          }
        }
      },
      {
        $group: {
          _id: '$durationCategory',
          count: { $sum: 1 }
        }
      }
    ]);

    const earnings = await Bookings.aggregate([
      { $match: { teacherId: objectId, lessonCompletedStudent: true, lessonCompletedTeacher: true } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$teacherEarning" },
          pendingEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$payoutCreationDate", null] },
                "$teacherEarning",
                0
              ]
            }
          },
          requestedEarnings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$payoutCreationDate", null] },
                    { $eq: ["$payoutDoneAt", null] }
                  ]
                },
                "$teacherEarning",
                0
              ]
            }
          },
          approvedEarnings: {
            $sum: {
              $cond: [
                { $ne: ["$payoutDoneAt", null] },
                "$teacherEarning",
                0
              ]
            }
          }
        }
      }
    ]);
    const earningsSummary = earnings[0] || {
      totalEarnings: 0,
      pendingEarnings: 0,
      approvedEarnings: 0
    };

    const paypalamount = await Bookings.aggregate([
      {
        $match: {
          teacherId: objectId,
          paypalpaymentId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          totalPaypalAmount: { $sum: '$teacherEarning' }
        }
      }
    ]);
    const paypalpay = paypalamount.length > 0 ? paypalamount[0].totalPaypalAmount : 0;

    const stripeamount = await Bookings.aggregate([
      {
        $match: {
          teacherId: objectId,
          StripepaymentId: { $exists: true, $ne: null },
          lessonCompletedStudent: true,
          lessonCompletedTeacher: true,
        }
      },
      {
        $group: {
          _id: null,
          totalstripeAmount: { $sum: '$teacherEarning' }
        }
      }
    ]);
    const stripepay = stripeamount.length > 0 ? stripeamount[0].totalstripeAmount : 0;

    const today = new Date();

    const upcomingLesson = await Bookings.find({
      teacherId: objectId,
      startDateTime: { $gt: today }
    })
      .sort({ startDateTime: 1 }).limit(3).select('startDateTime').populate({
        path: "LessonId",
        select: "title"
      });


    successResponse(res, "Bookings retrieved successfully!", 200,
      { upcomingLesson, TeacherData, ReviewesCount, result, earningsSummary, paypalpay, stripepay });

  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

// Special Slot apis
exports.SpecialSlotCreate = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);

    let { student, lesson, amount, startDateTime, endDateTime } = req.body;
    const time_zone = req.user.time_zone;

    if (!student || !lesson || !amount || !startDateTime || !endDateTime) {
      return errorResponse(res, "All fields are required", 400);
    }

    // Convert input to UTC
    const start = DateTime.fromISO(startDateTime, { zone: time_zone });
    const end = DateTime.fromISO(endDateTime, { zone: time_zone });

    const startUTC = start.toUTC().toJSDate();
    const endUTC = end.toUTC().toJSDate();

    const availabilityBlocks = await TeacherAvailability.find({ teacher: objectId });
    // Check for overlap with availability
    const slotOverlaps = availabilityBlocks.some((block) => {
      return (
        startUTC < block.endDateTime && endUTC > block.startDateTime
      );
    });

    if (slotOverlaps) {
      return errorResponse(
        res,
        "You already have an availability in the given time. Special slots are not allowed.",
        400
      );
    }

    const user = await User.findById(student);
    if (!user) {
      return errorResponse(res, "Invalid student id", 400);
    }

    const slot = new SpecialSlot({
      student,
      lesson,
      amount,
      startDateTime: startUTC,
      endDateTime: endUTC,
      teacher: req.user.id,
    });

    const slotResult = await slot.save();

    if (!slotResult) {
      return errorResponse(res, "Failed to add special slot.", 500);
    }
    const token = jwt.sign(
      { id: slotResult?._id },
      process.env.JWT_SECRET_KEY,
      { expiresIn: "48h" }
    );
    const link = `https://japaneseforme.com/slot/${token}`;

    // Email Sending logic
    const teacher = await User.findById(req.user.id);
    const registrationSubject = "Special Slot Created 🎉";
    const emailHtml = SpecialSlotEmail(user?.name, teacher?.name, startUTC, link, amount, endUTC);
    await sendEmail({
      email: user.email,
      subject: registrationSubject,
      emailHtml
    });

    return successResponse(res, "Special Slot created successfully", 201, slotResult);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.StudentLessonListing = catchAsync(async (req, res) => {
  try {
    const lessons = await Lesson.find({ teacher: req.user.id, is_deleted: { $ne: true } });
    const students = await User.find({ role: "student", block: false, email_verify: true });
    return successResponse(res, "Special Slot created successfully", 201, {
      lessons,
      students
    });
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SpecialSlotList = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);
    const { status } = req.query;
    const filter = { teacher: objectId };
    if (status && status != "") {
      filter.paymentStatus = status;
    }
    const data = await SpecialSlot.find(filter)
      .populate("student")
      .populate("teacher")
      .populate("lesson")
      .sort({ createdAt: -1 });
    if (!data) {
      return errorResponse(res, "Special Slots not Found", 401);
    }
    successResponse(res, "Special Slots retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SpecialSlotData = catchAsync(async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const id = decoded.id;
    const data = await SpecialSlot.findById(id)
      .populate("student")
      .populate("teacher")
      .populate("lesson")
      .sort({ createdAt: -1 });
    if (!data) {
      return errorResponse(res, "Data not Found", 401);
    }
    successResponse(res, "Data retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.DeleteGetLesson = catchAsync(async (req, res) => {
  try {
    const { _id, status } = req.body;
    const lessons = await Lesson.findByIdAndUpdate(_id, {
      is_deleted: status
    })
    return successResponse(res, "Lessons retrieved successfully", 200, lessons);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});
