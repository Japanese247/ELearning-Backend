const TeacherAvailability = require("../model/TeacherAvailability");
const Bookings = require("../model/booking");
const Lesson = require("../model/lesson");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse, validationErrorResponse } = require("../utils/ErrorHandling");
const { DateTime } = require("luxon");
const logger = require("../utils/Logger");
const { uploadFileToSpaces, deleteFileFromSpaces } = require("../utils/FileUploader");
const User = require("../model/user");
const Payout = require("../model/Payout");
const Teacher = require("../model/teacher");
const BulkLesson = require("../model/bulkLesson");
const SpecialSlot = require("../model/SpecialSlot");
const Review = require("../model/review");
const Currencies = require("../model/Currency");
const mongoose = require('mongoose');
const sendEmail = require("../utils/EmailMailler");
const SpecialSlotEmail = require("../EmailTemplate/SpecialSlot");
const SpecialSlotFreeEmail = require("../EmailTemplate/FreeSpecialSlot");
const SpecialSlotBulkEmail = require("../EmailTemplate/BulkSpecialSlot");
const jwt = require("jsonwebtoken"); 
const review = require("../model/review"); 
const Bonus = require("../model/Bonus"); 
const Welcome = require("../EmailTemplate/Welcome");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const axios = require("axios");
const ReviewTemplate = require("../EmailTemplate/Review");
const { getValidGoogleClient } = require("../utils/GoogleCalendar");
// const crypto = require("crypto");

// configure DO Spaces S3 client (matches your uploader config)
const s3Client = new S3Client({
  region: process.env.region,
  endpoint: `https://${process.env.endpoint}`, // Endpoint for your DigitalOcean Space
  credentials: {
    accessKeyId: process.env.accesskeyId, // Your DigitalOcean Space Access Key
    secretAccessKey: process.env.secretAccess, // Your DigitalOcean Space Secret Key
  },
});

const getSignedRecordingUrl = async (key, expiresInSeconds = 60 * 5) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.bucketName,
      Key: key,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    return signedUrl;
  } catch (err) {
    console.error(`Signed URL generation failed for key "${key}":`, err.message || err);
    return null;
  }
};

exports.AddAvailability = catchAsync(async (req, res) => {
  try {
    let { startDateTime, endDateTime } = req.body;
    const time_zone = req.user.time_zone;

    // console.log("time_zone", time_zone);
    // console.log("startDateTime", startDateTime);
    // console.log("endDateTime", endDateTime);

    // Check if zoom is connected
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }
    // 🔎 Check if Zoom is connected for this teacher
    const teacher = await Teacher.findOne({
      userId: teacherId,
      access_token: { $ne: null },
      refresh_token: { $ne: null },
    });

    if (!teacher) {
      return errorResponse(
        res,
        "Please connect Zoom account before creating slots",
        400
      );
    }    

    if (!startDateTime || !endDateTime) {
      return errorResponse(res, "Start time and End time are required", 400);
    }

    // Convert to UTC using Luxon
    let startUTC = DateTime.fromISO(startDateTime, { zone: time_zone }).toUTC();
    let endUTC = DateTime.fromISO(endDateTime, { zone: time_zone }).toUTC();

    // console.log("startUTC", startUTC.toISO());
    // console.log("endUTC", endUTC.toISO());

    if (startUTC >= endUTC) {
      return errorResponse(res, "End time must be after start time", 400);
    }

    // Fetch existing availability slots
    const existingAvailabilities = await TeacherAvailability.find({ teacher: req.user.id });

    // Create 30-minute slots
    let currentStart = startUTC;
    const slots = [];

    while (currentStart < endUTC) {
      const currentEnd = currentStart.plus({ minutes: 30 });

      // Check if this 30-min slot overlaps with any existing availability
      const isOverlapping = existingAvailabilities.some(avail => {
        const availStart = DateTime.fromJSDate(avail.startDateTime);
        const availEnd = DateTime.fromJSDate(avail.endDateTime);
        return currentStart < availEnd && currentEnd > availStart;
      });

      if (isOverlapping) {
        return errorResponse(
          res,
          `Availability overlaps with existing schedule`,
          400
        );
      }

      // Push this valid slot to the list
      slots.push({
        teacher: req.user.id,
        startDateTime: currentStart.toJSDate(),
        endDateTime: currentEnd.toJSDate(),
      });

      currentStart = currentEnd;
    }

    // Save all valid slots in one go
    const savedSlots = await TeacherAvailability.insertMany(slots);

    return successResponse(res, "Availability added successfully", 201, savedSlots);
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
    const { slots } = req.body;
    const id = req.user.id;

    if (!slots) {
      return errorResponse(res, "Slots are required", 400);
    }

    const slotsArray = Array.isArray(slots) ? slots : [slots];

    if (slotsArray.length === 0) {
      return errorResponse(res, "Slots array cannot be empty", 400);
    }

    const result = await TeacherAvailability.deleteMany({
      _id: { $in: slotsArray },
      teacher: id,
    });

    if (result.deletedCount === 0) {
      return errorResponse(res, "No availability found for given IDs", 404);
    }

    const message =
      result.deletedCount === 1
        ? "Availability removed successfully"
        : `${result.deletedCount} availability slots removed successfully`;

    return successResponse(res, message, 200);
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
    // console.log("bookings", bookings);

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
        const nextStart = new Date(bEnd.getTime());
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

    const transformedBookings = bookings.map(item => ({
      teacher: item.teacherId,
      startDateTime: item.startDateTime,
      endDateTime: item.endDateTime
    }));

    return successResponse(res, "Availability processed", 200, {
      availabilityBlocks: availableSlots,
      bookedSlots: transformedBookings,
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
    const lessons = await Lesson.find({ teacher: teacherId }).sort({ is_deleted: 1 }).populate("teacher");
    // if (!lessons || lessons.length === 0) {
    //   return errorResponse(res, "No lessons found", 404);
    // }
    return successResponse(res, "Lessons retrieved successfully", 200, {
      profile,
      lessons: lessons || [],
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

exports.EmailCheck = catchAsync(async (req, res) => {
  try {
        const link = `https://akitainakaschoolonline.com/verify/123456`;
        const registrationSubject = "Welcome to Japanese for Me!🎉 Your account has been created.";
        const emailHtml = Welcome("Abhinav", link);
        console.log("About to send email");
        const record = await sendEmail({
          email: "test-g41ry9h11@srv1.mail-tester.com",
          subject: registrationSubject,
          emailHtml: emailHtml,
        });
        res.status(200).json({
          status: false,
          message: "Email sent successfully!"
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

// Normalizing req.body to resolve the null issue
const normalizeFormData = (body) => {
  const parse = (value) => {
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;

    try {
      const parsed = JSON.parse(value);
      // Return arrays/objects parsed from JSON
      if (typeof parsed === 'object') return parsed;
    } catch (_) {}

    return value; // keep as string
  };

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, parse(value)])
  );
};

exports.updateProfile = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const files = req.files || {};
    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }

    // console.log("req.body",req.body);
    const normalizedBody = normalizeFormData(req.body);
    // console.log("normalizedBody",normalizedBody);
    const {
      name,
      email,
      timezone,
      nationality,
      languages_spoken,
      // gender,
      ais_trained,
      intro_video,
      interest,
      experience,
      description,
      qualifications,
      tags,
      bulk_bookings_allowed,
    } = normalizedBody;

    const userUpdates = {};
    const teacherUpdates = {};

    const user = await User.findById(userId);
    const teacher = await Teacher.findOne({ userId });
    if (!user || !teacher) {
      return errorResponse(res, "User not found", 404);
    }

    // Checking if the changed email already exists
    if (user.email !== email) {
      const exists = await User.exists({ email: email });
      if (exists) {
        return errorResponse(res, "A User with the same email already exists", 404);
      }
    }

    let profile_photo = null;
    if (files.profile_photo?.[0]) {
      if (user?.profile_photo) {
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
    if (name !== undefined && name !== null && name !== '') userUpdates.name = name;
    if (email !== undefined && email !== null && email !== '') userUpdates.email = email;
    if (timezone !== undefined && timezone !== null && timezone !== '') userUpdates.time_zone = timezone;
    if (nationality !== undefined && nationality !== null && nationality !== '') userUpdates.nationality = nationality;
    if (profile_photo !== undefined && profile_photo !== null && profile_photo !== "") {
      userUpdates.profile_photo = profile_photo;
    }

    if (languages_spoken !== undefined && languages_spoken !== null && languages_spoken !== '[]') teacherUpdates.languages_spoken = languages_spoken;
    // if (gender !== undefined && gender !== null && gender !== '') teacherUpdates.gender = gender;
    if (ais_trained !== undefined && ais_trained !== null && ais_trained !== '') teacherUpdates.ais_trained = ais_trained;
    if (bulk_bookings_allowed !== undefined && bulk_bookings_allowed !== null && bulk_bookings_allowed !== '') teacherUpdates.bulk_bookings_allowed = bulk_bookings_allowed;
    if (intro_video !== undefined && intro_video !== null && intro_video !== '') teacherUpdates.intro_video = intro_video;
    if (interest !== undefined && interest !== null && interest !== '') teacherUpdates.interest = interest;
    if (experience !== undefined && experience !== null && experience !== '') teacherUpdates.experience = experience;
    if (description !== undefined && description !== null && description !== '') teacherUpdates.description = description;
    // if (average_price !== undefined) teacherUpdates.average_price = average_price;
    // if (average_time !== undefined) teacherUpdates.average_time = average_time;
    if (tags !== undefined && tags !== null && tags !=='[]') teacherUpdates.tags = tags;
    if (qualifications !== undefined && qualifications !== null && qualifications !== '') teacherUpdates.qualifications = qualifications;
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
    const { date, search } = req.query;

    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }
    const objectId = new mongoose.Types.ObjectId(userId);
    const filter = {
      teacherId: objectId,
      cancelled: false,
      lessonCompletedStudent: true,
      lessonCompletedTeacher: true,
    };
    const bonusFilter = {
      teacherId: objectId,
    };

    if (date) {
      const now = new Date();

      if (date === "last7") {
        const from = new Date();
        from.setDate(now.getDate() - 7);
        filter.createdAt = { $gte: from, $lte: now };
        bonusFilter.createdAt = { $gte: from, $lte: now };

      } else if (date === "last30") {
        const from = new Date();
        from.setDate(now.getDate() - 30);
        filter.createdAt = { $gte: from, $lte: now };
        bonusFilter.createdAt = { $gte: from, $lte: now };

      } else if (!isNaN(date)) {
        // If it's a year like "2024"
        const year = parseInt(date, 10);
        const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
        const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);
        filter.createdAt = { $gte: startOfYear, $lte: endOfYear };
        bonusFilter.createdAt = { $gte: startOfYear, $lte: endOfYear };
      }
    }

    // Get detailed booking data
    let data = await Bookings.find(filter)
      .sort({ startDateTime: -1 })
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('UserId')
      .populate('LessonId')
      .populate('zoom')
      .populate('BonusId');

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

    // Get detailed booking data
    let bonusData = await Bonus.find(bonusFilter)
      .sort({ startDateTime: -1 })
      .populate('userId')
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('bookingId')
      .populate('LessonId');

    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i"); // case-insensitive match

      bonusData = bonusData.filter((item) => {
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

    // Aggregate the earnings
    const rateDoc = await Currencies.findOne({ currency: "JPY" });
    const fallbackJpyRate = Number(rateDoc?.rate || 0) || 0;

    const bookingIdsToBackfillRate = [];
    for (const booking of data) {
      const currentRate = Number(booking?.usdToJpyRate || 0) || 0;
      if (
        fallbackJpyRate > 0 &&
        (currentRate <= 0 || currentRate < 90 || currentRate > 300)
      ) {
        booking.usdToJpyRate = fallbackJpyRate;
        bookingIdsToBackfillRate.push(booking._id);
      }
    }
    if (bookingIdsToBackfillRate.length && fallbackJpyRate > 0) {
      await Bookings.updateMany(
        {
          _id: { $in: bookingIdsToBackfillRate },
          $or: [
            { usdToJpyRate: { $in: [0, null] } },
            { usdToJpyRate: { $lt: 90 } },
            { usdToJpyRate: { $gt: 300 } },
          ],
        },
        { $set: { usdToJpyRate: fallbackJpyRate } }
      );
    }

    const bonusIdsToBackfillRate = [];
    for (const bonusItem of bonusData) {
      const currentRate = Number(bonusItem?.usdToJpyRate || 0) || 0;
      if (
        fallbackJpyRate > 0 &&
        (currentRate <= 0 || currentRate < 90 || currentRate > 300)
      ) {
        bonusItem.usdToJpyRate = fallbackJpyRate;
        bonusIdsToBackfillRate.push(bonusItem._id);
      }
    }
    if (bonusIdsToBackfillRate.length && fallbackJpyRate > 0) {
      await Bonus.updateMany(
        {
          _id: { $in: bonusIdsToBackfillRate },
          $or: [
            { usdToJpyRate: { $in: [0, null] } },
            { usdToJpyRate: { $lt: 90 } },
            { usdToJpyRate: { $gt: 300 } },
          ],
        },
        { $set: { usdToJpyRate: fallbackJpyRate } }
      );
    }

    const sumJpy = (amountUsd, rate) => {
      const usd = Number(amountUsd || 0) || 0;
      const r = Number(rate || 0) || 0;
      return usd * r;
    };

    const mainJpyTotals = data.reduce(
      (acc, b) => {
        const rate = Number(b?.usdToJpyRate || fallbackJpyRate || 0) || 0;
        const earnedJpy = sumJpy(b?.teacherEarning, rate);
        acc.totalEarnings += earnedJpy;
        if (!b?.payoutCreationDate) {
          acc.pendingEarnings += earnedJpy;
        } else if (b?.payoutCreationDate && !b?.payoutDoneAt) {
          acc.requestedEarnings += earnedJpy;
        }
        return acc;
      },
      { totalEarnings: 0, pendingEarnings: 0, requestedEarnings: 0 }
    );

    const bonusJpyTotals = bonusData.reduce(
      (acc, b) => {
        const rate = Number(b?.usdToJpyRate || fallbackJpyRate || 0) || 0;
        const earnedJpy = sumJpy(b?.amount, rate);
        acc.totalEarnings += earnedJpy;
        if (!b?.payoutCreationDate) {
          acc.pendingEarnings += earnedJpy;
        } else if (b?.payoutCreationDate && !b?.payoutDoneAt) {
          acc.requestedEarnings += earnedJpy;
        }
        return acc;
      },
      { totalEarnings: 0, pendingEarnings: 0, requestedEarnings: 0 }
    );

    const payoutDone = await Payout.findOne({
      userId: userId,
      Status: "approved"
    }).sort({ createdAt: -1 });

    // const bonusEarnings = await Bonus.aggregate([
    //   { $match: bonusFilter },
    //   {
    //     $group: {
    //       _id: null,
    //       totalEarnings: { $sum: "$amount" },
    //       pendingEarnings: {
    //         $sum: {
    //           $cond: [
    //             { $eq: ["$payoutCreationDate", null] },
    //             "$amount",
    //             0
    //           ]
    //         }
    //       },
    //       requestedEarnings: {
    //         $sum: {
    //           $cond: [
    //             {
    //               $and: [
    //                 { $ne: ["$payoutCreationDate", null] },
    //                 { $eq: ["$payoutDoneAt", null] }
    //               ]
    //             },
    //             "$amount",
    //             0
    //           ]
    //         }
    //       },
    //       approvedEarnings: {
    //         $sum: {
    //           $cond: [
    //             { $ne: ["$payoutDoneAt", null] },
    //             "$amount",
    //             0
    //           ]
    //         }
    //       }
    //     }
    //   }
    // ]);

    // console.log("earnings",earnings);
    // console.log("bonusEarnings",bonusEarnings);
    
    const earningsSummary = {
      totalEarnings: (mainJpyTotals.totalEarnings || 0) + (bonusJpyTotals.totalEarnings || 0),
      pendingEarnings: (mainJpyTotals.pendingEarnings || 0) + (bonusJpyTotals.pendingEarnings || 0),
      requestedEarnings: (mainJpyTotals.requestedEarnings || 0) + (bonusJpyTotals.requestedEarnings || 0),
      approvedEarnings: ((payoutDone ? payoutDone?.amountInJpy : 0) || 0),
    };

    // Get total pending earning
    const totalPendingEarning = data.reduce((sum, b) => {
      if (!b?.payoutCreationDate) return sum + (Number(b?.teacherEarning || 0) || 0);
      return sum;
    }, 0) + bonusData.reduce((sum, b) => {
      if (!b?.payoutCreationDate) return sum + (Number(b?.amount || 0) || 0);
      return sum;
    }, 0);

    const totalPendingEarningJpy = data.reduce((sum, b) => {
      if (!b?.payoutCreationDate) {
        const rate = Number(b?.usdToJpyRate || fallbackJpyRate || 0) || 0;
        return sum + sumJpy(b?.teacherEarning, rate);
      }
      return sum;
    }, 0) + bonusData.reduce((sum, b) => {
      if (!b?.payoutCreationDate) {
        const rate = Number(b?.usdToJpyRate || fallbackJpyRate || 0) || 0;
        return sum + sumJpy(b?.amount, rate);
      }
      return sum;
    }, 0);


    successResponse(res, "User Get successfully!", 200, {
      bookings: data,
      earningsSummary,
      bonusData,
      totalPendingEarning,
      totalPendingEarningJpy,
    });
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.BookingsGet = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) return errorResponse(res, "Invalid User", 401);

    const filter = { teacherId: userId };
    const sort = {};
    const { type, search } = req.query;
    const now = Date.now();

    if (type === "upcoming") {
      filter.endDateTime = { $gt: now };
      sort.startDateTime = 1;
      filter.cancelled = false;
    } else if (type === "past") {
      filter.endDateTime = { $lte: now };
      sort.startDateTime = -1;
      filter.cancelled = false;
    } else if (type === "cancelled") {
      filter.cancelled = true;
      sort.startDateTime = -1;
    }

    // Fetch bookings with populated relations
    let data = await Bookings.find(filter).sort(sort)
      .populate("StripepaymentId")
      .populate("paypalpaymentId")
      .populate("UserId")
      .populate("LessonId")
      .populate("ReviewId")
      .populate("BonusId")
      .populate("teacherId")
      .populate("zoom");

    // Apply search filter (unchanged)
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

    // Replace private recording keys with temporary signed URLs (5 minutes).
    // Keep old full URLs untouched.
    // await Promise.all(
    //   data.map(async (booking) => {
    //     try {
    //       if (!booking?.zoom || !Array.isArray(booking.zoom.download)) return;

    //       // Map files -> for each file, if it's a private key 'recordings/...' generate signed url
    //       const mapped = await Promise.all(
    //         booking.zoom.download.map(async (fileEntry) => {
    //           try {
    //             if (typeof fileEntry !== "string") return null;

    //             // NEW private-style key (our convention): recordings/...
    //             if (fileEntry.startsWith("recordings/")) {
    //               const signed = await getSignedRecordingUrl(fileEntry, 60 * 5); // 5 minutes
    //               return signed || null; // if signing failed, return null (will be filtered)
    //             }

    //             // OLD public URL (starts with http/https) -> ignore / return as-is
    //             if (fileEntry.startsWith("http://") || fileEntry.startsWith("https://")) {
    //               return fileEntry;
    //             }

    //             // If value looks like an S3 key but not recordings/..., you can decide:
    //             // For safety, leave it as-is. (Alternatively you may sign other prefixes.)
    //             return fileEntry;
    //           } catch (innerErr) {
    //             console.error("Error processing recording entry:", innerErr.message || innerErr);
    //             return null;
    //           }
    //         })
    //       );

    //       // Filter out any nulls (failed signings) and set back on booking.zoom.download
    //       booking.zoom.download = mapped.filter(Boolean);
    //     } catch (err) {
    //       console.error("Error mapping booking zoom.download:", err.message || err);
    //     }
    //   })
    // );

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
    const TeacherData = await Lesson.find({
      teacher: userId,
      is_deleted: false,
    }).sort({ price: 1 });

    // console.log("objectId",objectId);

    const Reviews = await Review.find({review_status: "Accept"}).populate("lessonId").sort({ createdAt: -1 });
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
                { case: { $eq: ['$lesson.duration', 60] }, then: 'duration60' }
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

    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 30);

    const earnings = await Bookings.aggregate([
      { $match: { teacherId: objectId, lessonCompletedStudent: true, lessonCompletedTeacher: true, createdAt: { $gte: from, $lte: now } } },
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
    const bonusEarnings = await Bonus.aggregate([
      { $match: { teacherId: objectId, createdAt: { $gte: from, $lte: now } } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$amount" },
          pendingEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$payoutCreationDate", null] },
                "$amount",
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
                "$amount",
                0
              ]
            }
          },
          approvedEarnings: {
            $sum: {
              $cond: [
                { $ne: ["$payoutDoneAt", null] },
                "$amount",
                0
              ]
            }
          }
        }
      }
    ]);
    // console.log("earnings",earnings);
    // console.log("bonusEarnings",bonusEarnings);
    const base = {
      totalEarnings: 0,
      pendingEarnings: 0,
      requestedEarnings: 0,
      approvedEarnings: 0,
    };
    const mainEarnings = earnings[0] || base;
    const bonus = bonusEarnings[0] || base;
    const earningsSummary = {
      totalEarnings: (mainEarnings.totalEarnings || 0) + (bonus.totalEarnings || 0),
      pendingEarnings: (mainEarnings.pendingEarnings || 0) + (bonus.pendingEarnings || 0),
      requestedEarnings: (mainEarnings.requestedEarnings || 0) + (bonus.requestedEarnings || 0),
      approvedEarnings: (mainEarnings.approvedEarnings || 0) + (bonus.approvedEarnings || 0),
    };

    const paypalamount = await Bookings.aggregate([
      {
        $match: {
          teacherId: objectId,
          paypalpaymentId: { $exists: true, $ne: null },
          createdAt: { $gte: from, $lte: now }
          // startDateTime: { $gte: from, $lte: now }
        }
      },
      {
        $group: {
          _id: null,
          totalPaypalAmount: { $sum: '$teacherEarning' }
        }
      }
    ]);
    const paypalBonusAmount = await Bonus.aggregate([
      {
        $match: { teacherId: objectId, paypalpaymentId: { $exists: true, $ne: null }, createdAt: { $gte: from, $lte: now } }
      },
      {
        $group: {
          _id: null,
          totalPaypalAmount: { $sum: '$amount' }
        }
      }
    ]);
    // console.log("paypalamount",paypalamount);
    // console.log("paypalBonusAmount",paypalBonusAmount);
    const totalPaypalAmount = paypalamount.length > 0 ? paypalamount[0].totalPaypalAmount : 0;
    const totalPaypalBonusAmount = paypalBonusAmount.length > 0 ? paypalBonusAmount[0].totalPaypalAmount : 0;
    const paypalpay = totalPaypalAmount + totalPaypalBonusAmount;

    const stripeamount = await Bookings.aggregate([
      {
        $match: {
          teacherId: objectId,
          StripepaymentId: { $exists: true, $ne: null },
          lessonCompletedStudent: true,
          lessonCompletedTeacher: true,
          createdAt: { $gte: from, $lte: now }
        }
      },
      {
        $group: {
          _id: null,
          totalstripeAmount: { $sum: '$teacherEarning' }
        }
      }
    ]);
    const stripeBonusamount = await Bonus.aggregate([
      {
        $match: {
          teacherId: objectId,
          StripepaymentId: { $exists: true, $ne: null },
          createdAt: { $gte: from, $lte: now }
        }
      },
      {
        $group: {
          _id: null,
          totalstripeAmount: { $sum: '$amount' }
        }
      }
    ]);
    // console.log("stripeamount",stripeamount);
    // console.log("stripeBonusamount",stripeBonusamount);
    const totalStripeAmount = stripeamount.length > 0 ? stripeamount[0].totalstripeAmount : 0;
    const totalStripeBonusAmount = stripeBonusamount.length > 0 ? stripeBonusamount[0].totalstripeAmount : 0;
    const stripepay = totalStripeAmount + totalStripeBonusAmount;

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

    // Check if zoom is connected
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }
    // 🔎 Check if Zoom is connected for this teacher
    const ZoomConnectedAccount = await Teacher.findOne({
      userId: teacherId,
      access_token: { $ne: null },
      refresh_token: { $ne: null },
    });

    if (!ZoomConnectedAccount) {
      return errorResponse(
        res,
        "Please connect Zoom account before creating special slot",
        400
      );
    }  

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

    // ⛔ Check if start time is in the past or less than 3 hours from now
    const nowUTC = new Date();
    // const threeHoursLater = new Date(nowUTC.getTime() + 3 * 60 * 60 * 1000);
    const thirtyMinutesLater = new Date(nowUTC.getTime() + 10 * 60 * 1000);

    if (startUTC <= nowUTC || startUTC < thirtyMinutesLater) {
      return errorResponse(res, "Start time must be at least 10 minutes from now.", 400);
    }

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
    // console.log("objectId", objectId);
    // console.log("startUTC",startUTC);
    // console.log("endUTC",endUTC);

    const existingSpecialSlots = await SpecialSlot.find({ teacher: objectId });
    // console.log("existingSpecialSlots", existingSpecialSlots);

    const specialSlotOverlaps = existingSpecialSlots.some((slot) => {
      return (
        startUTC < slot.endDateTime && endUTC > slot.startDateTime
      );
    });
    // console.log("specialSlotOverlaps", specialSlotOverlaps);

    if (specialSlotOverlaps) {
      return errorResponse(
        res,
        "You already have a special slot in the given time.",
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
    const link = `https://akitainakaschoolonline.com/slot/${token}`;

    // Convert to ISO format for moment parsing in email templates
    const utcDateTime = DateTime.fromJSDate(new Date(startUTC), { zone: "utc" });
    const startTimeISO = user?.time_zone
        ? utcDateTime.setZone(user.time_zone).toISO()
        : utcDateTime.toISO();

    const utcDateTimeEnd = DateTime.fromJSDate(new Date(endUTC), { zone: "utc" });
    const endTimeISO = user?.time_zone
        ? utcDateTimeEnd.setZone(user.time_zone).toISO()
        : utcDateTimeEnd.toISO();

    // Email Sending logic
    const teacher = await User.findById(req.user.id);
    const registrationSubject = "Special Slot Created 🎉";
    const emailHtml = SpecialSlotEmail(user?.name, teacher?.name, startTimeISO, link, amount, endTimeISO);
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

exports.SpecialSlotCancel = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "Special Slot ID is required", 400);
    }
    let data = await SpecialSlot.findById(id)
      .populate("student")
      .populate("teacher")
      .populate("lesson");

    if (!data) {
      const bookingById = await Bookings.findOne({
        _id: id,
        teacherId: req.user.id,
        cancelled: false,
        specialSlotId: { $ne: null },
      });
      if (!bookingById) {
        return errorResponse(res, "Special Slot not found", 404);
      }
      data = await SpecialSlot.findById(bookingById.specialSlotId)
        .populate("student")
        .populate("teacher")
        .populate("lesson");
      if (!data) {
        return errorResponse(res, "Special Slot not found", 404);
      }
    }
    if (String(data.teacher?._id || data.teacher) !== String(req.user.id)) {
      return errorResponse(res, "You are not allowed to cancel this slot", 403);
    }
    if (data.cancelled) {
      return successResponse(res, "Special Slot is already cancelled", 200);
    }
    const nowUTC = new Date();
    if (nowUTC >= new Date(data.startDateTime)) {
      return errorResponse(
        res,
        "You can't cancel this special slot after the lesson has started",
        400
      );
    }

    const booking =
      (await Bookings.findOne({
        teacherId: req.user.id,
        specialSlotId: data._id,
        cancelled: false,
      })) ||
      (await Bookings.findOne({
        teacherId: req.user.id,
        UserId: data.student?._id || data.student,
        LessonId: data.lesson?._id || data.lesson,
        startDateTime: data.startDateTime,
        endDateTime: data.endDateTime,
        cancelled: false,
      }));
    if (booking && (booking.lessonCompletedStudent || booking.lessonCompletedTeacher)) {
      return errorResponse(
        res,
        "You can't cancel this special slot because the lesson is already completed",
        400
      );
    }

    data.cancelled = true;
    await data.save();
    if (booking) {
      booking.cancelled = true;
      booking.zoom = null;
      await booking.save();
    }

    return successResponse(res, "Special Slot cancelled successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SpecialSlotwithZeroAmount = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);

    // Check if zoom is connected
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }
    // 🔎 Check if Zoom is connected for this teacher
    const ZoomConnectedAccount = await Teacher.findOne({
      userId: teacherId,
      access_token: { $ne: null },
      refresh_token: { $ne: null },
    });

    if (!ZoomConnectedAccount) {
      return errorResponse(
        res,
        "Please connect Zoom account before creating special slot",
        400
      );
    }  

    let { student, lesson, amount, startDateTime, endDateTime } = req.body;
    // console.log("req.body", req.body);
    const time_zone = req.user.time_zone;

    if (!student || !lesson || !startDateTime || !endDateTime) {
      return errorResponse(res, "All fields are required", 400);
    }

    // Convert input to UTC
    const start = DateTime.fromISO(startDateTime, { zone: time_zone });
    const end = DateTime.fromISO(endDateTime, { zone: time_zone });

    const startUTC = start.toUTC().toJSDate();
    const endUTC = end.toUTC().toJSDate();

    // ⛔ Check if start time is in the past or less than 3 hours from now
    const nowUTC = new Date();
    // const threeHoursLater = new Date(nowUTC.getTime() + 3 * 60 * 60 * 1000);
     const thirtyMinutesLater = new Date(nowUTC.getTime() + 10 * 60 * 1000);

    if (startUTC <= nowUTC || startUTC < thirtyMinutesLater) {
      return errorResponse(res, "Start time must be at least 10 minutes from now.", 400);
    }

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
    // console.log("objectId", objectId);
    // console.log("startUTC",startUTC);
    // console.log("endUTC",endUTC);

    const existingSpecialSlots = await SpecialSlot.find({ teacher: objectId });
    // console.log("existingSpecialSlots", existingSpecialSlots);

    const specialSlotOverlaps = existingSpecialSlots.some((slot) => {
      return (
        startUTC < slot.endDateTime && endUTC > slot.startDateTime
      );
    });
    // console.log("specialSlotOverlaps", specialSlotOverlaps);

    if (specialSlotOverlaps) {
      return errorResponse(
        res,
        "You already have a special slot in the given time.",
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
      amount: 0,
      paymentStatus: "paid",
      startDateTime: startUTC,
      endDateTime: endUTC,
      teacher: req.user.id,
    });

    const slotResult = await slot.save();

    if (!slotResult) {
      return errorResponse(res, "Failed to add special slot.", 500);
    }
    
    const Bookingsave = new Bookings({
      teacherId: req.user.id,
      totalAmount: 0,
      adminCommission: 0,
      teacherEarning: 0,
      UserId: student,
      LessonId: lesson,
      startDateTime: startUTC,
      endDateTime: endUTC,
      processingFee: 0,
      lessonCompletedStudent: false,
      lessonCompletedTeacher: false,
      isSpecial: true,
      specialSlotId: slotResult._id,
    });

    await Bookingsave.save();


    // Convert to ISO format for moment parsing in email templates
    const utcDateTime = DateTime.fromJSDate(new Date(startUTC), { zone: "utc" });
    const startTimeISO = user?.time_zone
        ? utcDateTime.setZone(user.time_zone).toISO()
        : utcDateTime.toISO();

    const utcDateTimeEnd = DateTime.fromJSDate(new Date(endUTC), { zone: "utc" });
    const endTimeISO = user?.time_zone
        ? utcDateTimeEnd.setZone(user.time_zone).toISO()
        : utcDateTimeEnd.toISO();

    // // Email Sending logic
    const teacher = await User.findById(req.user.id);
    const registrationSubject = "Special Slot Created 🎉";
    const emailHtml = SpecialSlotFreeEmail(user?.name, teacher?.name, startTimeISO, endTimeISO);
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

exports.SpecialSlotUsingBulk = catchAsync(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const teacherId = req.user.id;
    const teacherObjectId = new mongoose.Types.ObjectId(teacherId);
    const { student, lesson, startDateTime, endDateTime } = req.body;
    const time_zone = req.user.time_zone;

    if (!teacherId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, "Teacher ID is required", 400);
    }

    if (!student || !lesson || !startDateTime || !endDateTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, "All fields are required", 400);
    }

    // 🔎 Check Zoom connection
    const zoomConnected = await Teacher.findOne({
      userId: teacherId,
      access_token: { $ne: null },
      refresh_token: { $ne: null },
    }).session(session);

    if (!zoomConnected) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        "Please connect your Zoom account before creating special slot",
        400
      );
    }

    // 🕒 Convert to UTC
    const start = DateTime.fromISO(startDateTime, { zone: time_zone });
    const end = DateTime.fromISO(endDateTime, { zone: time_zone });

    const startUTC = start.toUTC().toJSDate();
    const endUTC = end.toUTC().toJSDate();

    const nowUTC = new Date();
    const tenMinutesLater = new Date(nowUTC.getTime() + 10 * 60 * 1000);

    if (startUTC <= nowUTC || startUTC < tenMinutesLater) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        "Start time must be at least 10 minutes from now.",
        400
      );
    }

    // 🚫 Check teacher availability overlap
    const availabilityConflict = await TeacherAvailability.findOne({
      teacher: teacherObjectId,
      startDateTime: { $lt: endUTC },
      endDateTime: { $gt: startUTC },
    }).session(session);

    if (availabilityConflict) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        "You already have an availability in the given time. Special slots are not allowed.",
        400
      );
    }

    // 🚫 Check special slot overlap
    const specialSlotConflict = await SpecialSlot.findOne({
      teacher: teacherObjectId,
      startDateTime: { $lt: endUTC },
      endDateTime: { $gt: startUTC },
      cancelled: { $ne: true },
    }).session(session);

    if (specialSlotConflict) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        "You already have a special slot in the given time.",
        400
      );
    }

    // 👤 Validate student
    const studentUser = await User.findById(student).session(session);
    if (!studentUser) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, "Invalid student id", 400);
    }

    // 🔥 ATOMIC bulk decrement (prevents race condition)
    const bulkRecord = await BulkLesson.findOneAndUpdate(
      {
        teacherId,
        UserId: student,
        LessonId: lesson,
        lessonsRemaining: { $gt: 0 },
      },
      { $inc: { lessonsRemaining: -1 } },
      { new: true, session }
    );

    if (!bulkRecord) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, "No bulk lesson credits available", 400);
    }

    // console.log("bulkRecord", bulkRecord);

    // 🆕 Create Special Slot
    const slot = await SpecialSlot.create(
      [
        {
          student,
          lesson,
          teacher: teacherId,
          amount: (bulkRecord?.totalAmount - bulkRecord?.processingFee)/bulkRecord?.totalLessons || 0,
          paymentStatus: "paid",
          startDateTime: startUTC,
          endDateTime: endUTC,
        },
      ],
      { session }
    );

    const slotDoc = slot[0];

    // 🆕 Create Booking
    const booking = await Bookings.create(
      [
        {
          teacherId,
          UserId: student,
          LessonId: lesson,
          startDateTime: startUTC,
          endDateTime: endUTC,
          totalAmount: bulkRecord?.totalAmount/bulkRecord?.totalLessons || 0,
          teacherEarning: bulkRecord?.teacherEarning/bulkRecord?.totalLessons || 0,
          adminCommission: bulkRecord?.adminCommission/bulkRecord?.totalLessons || 0,
          processingFee: bulkRecord?.processingFee/bulkRecord?.totalLessons || 0,
          isSpecial: true,
          isFromBulk: true,
          bulkId: bulkRecord._id,
          specialSlotId: slotDoc._id,
        },
      ],
      { session }
    );

    const bookingDoc = booking[0];

    // 🔗 Link booking back to slot
    // slotDoc.bookingId = bookingDoc._id;
    // await slotDoc.save({ session });

    // 🔗 Push booking inside bulk
    await BulkLesson.updateOne(
      { _id: bulkRecord._id },
      [
        {
          $set: {
            bookings: {
              $concatArrays: [
                { $ifNull: ["$bookings", []] },
                [
                  {
                    id: bookingDoc._id,
                    cancelled: false,
                  },
                ],
              ],
            },
          },
        },
      ],
      { session }
    );

    // ✅ Commit transaction
    await session.commitTransaction();
    session.endSession();

    // ================================
    // 📧 EMAIL AFTER COMMIT
    // ================================
    const utcStart = DateTime.fromJSDate(startUTC, { zone: "utc" });
    const utcEnd = DateTime.fromJSDate(endUTC, { zone: "utc" });

    const startISO = studentUser?.time_zone
      ? utcStart.setZone(studentUser.time_zone).toISO()
      : utcStart.toISO();

    const endISO = studentUser?.time_zone
      ? utcEnd.setZone(studentUser.time_zone).toISO()
      : utcEnd.toISO();

    const teacherUser = await User.findById(teacherId);

    await sendEmail({
      email: studentUser.email,
      subject: "Special Slot Created 🎉",
      emailHtml: SpecialSlotBulkEmail(
        studentUser?.name,
        teacherUser?.name,
        startISO,
        endISO
      ),
    });

    return successResponse(
      res,
      "Special Slot created successfully using bulk credit",
      201,
      slotDoc
    );
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("SpecialSlotUsingBulk Error:", error);
    return errorResponse(
      res,
      error.message || "Internal Server Error",
      500
    );
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
    const { status, search } = req.query;
    const filter = { teacher: objectId };
    if (status && status != "") {
      filter.paymentStatus = status;
    }
    let data = await SpecialSlot.find(filter)
      .populate("student")
      .populate("teacher")
      .populate("lesson")
      .sort({ startDateTime: -1 });
    if (!data) {
      return errorResponse(res, "Special Slots not Found", 401);
    }
    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i"); // case-insensitive match

      data = data.filter((item) => {
        const lessonTitle = item?.student?.name || "";
        return (
          regex.test(lessonTitle)
        );
      });
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
    return successResponse(res, "Lessons enabled successfully", 200, lessons);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetReview = catchAsync(async (req, res) => {
  try {
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }

    const lessons = await Lesson.find({
      teacher: teacherId,
      // is_deleted: { $ne: true }
    }).populate("teacher");

    if (!lessons || lessons.length === 0) {
      return errorResponse(res, "No lessons found", 404);
    }
    const lessonIds = lessons.map(lesson => lesson._id);
    const reviews = await review.find({
      lessonId: { $in: lessonIds },
    }).populate("lessonId").populate({
      path: "userId",
      select: "name profile_photo"
    }).sort({ createdAt: -1 });
    return successResponse(res, "Lessons and accepted reviews retrieved successfully", 200, reviews);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.DisconnectZoom = catchAsync(async (req, res) => {
  try {
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }
    // 🔎 Check for any upcoming, non-cancelled bookings
    const now = new Date();
    const hasUpcomingBooking = await Bookings.exists({
      teacherId: teacherId,
      cancelled: false,
      startDateTime: { $gt: now }  // booking starts in the future
    });

    if (hasUpcomingBooking) {
      return errorResponse(
        res,
        "Zoom account can't be disconnected as you have upcoming bookings in the future.",
        400
      );
    }
    const updatedTeacher = await Teacher.findOneAndUpdate(
     { userId: teacherId },
     { access_token: null, refresh_token: null },
     { new: true }
    );
    if (!updatedTeacher) {
      return errorResponse(res, "Teacher not found", 404);
    }
    return successResponse(res, "Zoom disconnected successfully", 200, updatedTeacher);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.DownloadRecording = catchAsync(async (req, res) => {
  try {
    const { url, index } = req.query;
    console.log("DownloadRecording url:", url);

    let finalUrl = url;

    // If it's a private key (recordings/...), sign it
    if (url && url.startsWith("recordings/")) {
      const signed = await getSignedRecordingUrl(url, 60 * 5);
      if (!signed) {
        return errorResponse(res, "Failed to generate download link", 500);
      }
      finalUrl = signed;
    }

    // Now fetch the file
    const response = await axios.get(finalUrl, { responseType: "stream" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="recording${index}.mp4"`
    );
    res.setHeader("Content-Type", "video/mp4");

    response.data.pipe(res);
  } catch (err) {
    logger.info("Recording download error:", err.message);
    return errorResponse(res, err.message || "Internal Server Error", 500);
  }
});

exports.LessonDone = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        status: false,
        msg: "Booking ID is required",
      });
    }
    const booking = await Bookings.findById(id);
    if (!booking) {
      return res.status(404).json({
        status: false,
        msg: "Booking not found",
      });
    }
    if (booking.lessonCompletedTeacher && booking.lessonCompletedStudent) {
      return res.status(200).json({
        status: true,
        msg: "Lesson already marked as done",
      });
    }
    let updatedBooking = booking;
    updatedBooking = await Bookings.findByIdAndUpdate(
      booking._id,
      { lessonCompletedTeacher: true },
      { new: true }
    );
    const userdata = await User.findById(updatedBooking?.UserId);
    if (userdata?.email) {
      const reviewLink = `https://akitainakaschoolonline.com/student/review/${updatedBooking._id}`;
      const reviewSubject = "🎉 Share your feedback with Japanese for Me!";
      const emailHtml = ReviewTemplate(userdata?.name, reviewLink);
      await sendEmail({
        email: userdata.email,
        subject: reviewSubject,
        emailHtml: emailHtml,
      });
      logger.info(
        `📧 Lesson review email sent to ${userdata.email} for booking ${updatedBooking._id}`
      );
    }
    return res.status(200).json({
      status: true,
      msg: "Lesson completion status updated successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      msg: "Something went wrong while updating lesson status",
      error: error.message,
    });
  }
});

exports.TeacherBulkLessonList = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);
    const { status, search } = req.query;
    let data = await BulkLesson.find({ teacherId: objectId })
      .populate("teacherId")
      .populate("UserId")
      .populate("LessonId")
      .populate("paypalpaymentId")
      .populate("StripepaymentId")
      .populate({
          path: "bookings.id",
          model: "Bookings"
        })
      .sort({ createdAt: -1 });
    if (!data) {
      return errorResponse(res, "Special Slots not Found", 404);
    }
    // if (search && search.trim() !== "") {
    //   const regex = new RegExp(search.trim(), "i"); // case-insensitive match

    //   data = data.filter((item) => {
    //     const lessonTitle = item?.student?.name || "";
    //     return (
    //       regex.test(lessonTitle)
    //     );
    //   });
    // }
    // console.log("data", data);

    successResponse(res, "Special Slots retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SyncTeacherCalendar = catchAsync(async (req, res) => {
  const teacherId = req.user.id;

  const teacher = await Teacher.findOne({ userId: teacherId });
  const user = await User.findById(teacherId);
  
  if (!teacher) {
    return errorResponse(res, "Teacher not found", 404);
  }
  if (!teacher?.googleCalendar?.connected) {
    return errorResponse(res, "Calendar not connected", 400);
  }
  const calendar = await getValidGoogleClient(teacher);
  const now = new Date();
  const bookings = await Bookings.find({
    teacherId,
    cancelled: false,
    calendarSynced: false,
    startDateTime: { $gt: now },
  })
    .populate("UserId")
    .populate("LessonId");
  if (!bookings.length) {
    return successResponse(res, "Calendar already up to date", 200);
  }
  let syncedCount = 0;
  for (const booking of bookings) {
    try {
      const event = {
        summary: `${booking.LessonId?.title || "Lesson"} with ${booking.UserId?.name}`,
        description: `Student: ${booking.UserId?.name}`,
        start: {
          dateTime: booking.startDateTime.toISOString(),
          timeZone: user.time_zone || "UTC",
        },
        end: {
          dateTime: booking.endDateTime.toISOString(),
          timeZone: user.time_zone || "UTC",
        },
      };
      const response = await calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
      });
      booking.calendarSynced = true;
      booking.calendarEventId = response.data.id;
      await booking.save();
      syncedCount++;
    } catch (err) {
      console.error("Calendar sync failed for booking:", booking._id, err.message);
    }
  }
  logger.info(`${syncedCount} booking(s) synced to Google Calendar for teacherid ${teacher?._id}`);
  return successResponse(res, `${syncedCount} booking(s) synced to Google Calendar`, 200);
});

exports.ReschedulePastBooking = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { startDateTime, endDateTime, timezone } = req.body;

  if (!id) {
    return errorResponse(res, "Booking ID is required", 400);
  }

  if (!startDateTime || !endDateTime || !timezone) {
    return errorResponse(res, "startDateTime, endDateTime and timezone are required", 400);
  }

  const booking = await Bookings.findById(id)
    .populate("teacherId")
    .populate("UserId");

  if (!booking) {
    return errorResponse(res, "Booking not found", 404);
  }

  if (booking.lessonCompletedTeacher) {
    return errorResponse(res, "Completed lesson cannot be rescheduled", 400);
  }

  if (DateTime.fromJSDate(booking.startDateTime) > DateTime.now()) {
    return errorResponse(res, "Booking is not in the past", 400);
  }

  const newStartUTC = DateTime.fromISO(startDateTime, {
    zone: timezone,
  }).toUTC();

  const newEndUTC = DateTime.fromISO(endDateTime, {
    zone: timezone,
  }).toUTC();

  const tenMinutesFromNow = DateTime.utc().plus({ minutes: 10 });

  if (newStartUTC < tenMinutesFromNow) {
    return errorResponse(
      res,
      "Start time must be at least 10 minutes from now",
      400
    );
  }

  booking.rescheduleHistory.push({
    before: booking.startDateTime,
    after: newStartUTC.toJSDate(),
    oldZoom: booking.zoom ? booking.zoom : null,
  });

  // 🔄 Update booking timing
  booking.startDateTime = newStartUTC.toJSDate();
  booking.endDateTime = newEndUTC.toJSDate();
  booking.rescheduled = true;
  booking.zoom = null;

  await booking.save();

  return successResponse(res, "Booking rescheduled successfully", 200, booking);
});

exports.RequestEnglishSupport = catchAsync(async (req, res) => {
  try {
    const teacherId = req.user.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }
    const updatedTeacher = await Teacher.findOneAndUpdate(
     { userId: teacherId },
     { englishSupportStatus: "pending"},
     { new: true }
    );
    if (!updatedTeacher) {
      return errorResponse(res, "Teacher not found", 404);
    }
    return successResponse(res, "English Support Requested Successfully", 200, updatedTeacher);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});
