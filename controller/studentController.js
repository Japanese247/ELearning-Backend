const Bookings = require("../model/booking");
const Payment = require("../model/PaypalPayment");
const stripePayments = require("../model/StripePayment");
const review = require("../model/review");
const Teacher = require("../model/teacher");
const Lesson = require("../model/lesson");
const TeacherAvailability = require("../model/TeacherAvailability");
const Wishlist = require("../model/wishlist");
const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse, validationErrorResponse } = require("../utils/ErrorHandling");
const Loggers = require("../utils/Logger");
const Booking = require("../model/booking");
const BulkLesson = require("../model/bulkLesson");
const Wallet = require("../model/wallet");
const WalletTransaction = require("../model/walletTransaction");
const SpecialSlot = require("../model/SpecialSlot");
const mongoose = require('mongoose');
const moment = require("moment"); 
const logger = require("../utils/Logger");
const { DateTime } = require("luxon");
const User = require("../model/user");
const sendEmail = require("../utils/EmailMailler");
const BookingSuccess = require("../EmailTemplate/BookingSuccess");
const TeacherBooking = require("../EmailTemplate/TeacherBooking");
const Currencies = require("../model/Currency");

exports.paymentget = catchAsync(async (req, res) => {
  try {
    const UserId = req.user.id;
    const BookingData = await Booking.find({
      UserId: UserId
    }).populate("LessonId").populate("paypalpaymentId").populate("StripepaymentId").populate("teacherId").sort({ createdAt: -1 })
    return successResponse(res, "Payment Get successfully!", 201, BookingData);
  } catch (error) {
    console.log("error", error);
    Loggers.error(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((el) => el.message);
      console.log("errors", errors);
      return validationErrorResponse(res, errors.join(", "), 400, "error");
    }
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.teacherget = catchAsync(async (req, res) => {
  try {
    const { search } = req.query;

    // Step 1: Get all teachers with userId populated
    let teachers = await Teacher.find({}).populate({
      path: "userId",
      select: "-password",
    });

    // Step 2: Filter for verified and not blocked users
    teachers = teachers.filter(
      (item) =>
        item?.userId?.email_verify === true && item?.userId?.block === false
    );

    // Step 3: Get valid teacher userIds
    const teacherUserIds = teachers.map(t => t?.userId?._id).filter(Boolean);

    // Step 4: Aggregate lessons grouped by teacher (userId)
    const lessonsAgg = await Lesson.aggregate([
      {
        $match: {
          is_deleted: false,
          teacher: { $in: teacherUserIds },
        },
      },
      {
        $group: {
          _id: "$teacher",
          count: { $sum: 1 },
        },
      },
    ]);

    // Step 5: Map lesson counts by teacherId
    const lessonCountMap = {};
    lessonsAgg.forEach(entry => {
      lessonCountMap[entry._id.toString()] = entry.count;
    });

    // Step 6: Remove teachers with 0 lessons
    teachers = teachers.filter(t => {
      const teacherId = t?.userId?._id?.toString();
      return lessonCountMap[teacherId] > 0;
    });

    teachers.sort((a, b) => {
      const aHasRank = a.rank !== null && a.rank !== undefined;
      const bHasRank = b.rank !== null && b.rank !== undefined;

      // Case 1: Both have rank -> sort by rank
      if (aHasRank && bHasRank) return a.rank - b.rank;

      // Case 2: Only one has rank -> ranked teacher first
      if (aHasRank && !bHasRank) return -1;
      if (!aHasRank && bHasRank) return 1;

      // Case 3: Neither has rank -> sort by createdAt (latest first)
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    // Step 7: Apply search filter (if provided)
    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i");
      teachers = teachers.filter((item) => {
        const teacherName = item?.userId?.name || "";
        return regex.test(teacherName);
      });
    }

    // Step 8: Get wishlist for current student
    const wishlistResult = await Wishlist.find({ student: req.user.id }).populate("teacher");

    if (!teachers.length) {
      return validationErrorResponse(res, "No teacher found", 400);
    }

    const size = wishlistResult.length;
    const wishlistEmails = wishlistResult.map((w) => w.teacher?.email);

    // Step 9: Add "isLiked" flag to teachers
    const updatedTeachers = teachers.map((t) => {
      const isLiked = wishlistEmails.includes(t.userId?.email);
      return {
        ...t.toObject(),
        isLiked,
      };
    });

    return successResponse(
      res,
      "Teachers retrieved successfully!",
      200,
      { teacher: updatedTeachers, favouriteSize: size }
    );
  } catch (error) {
    console.log("error", error);
    Loggers.error(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((el) => el.message);
      return validationErrorResponse(res, errors.join(", "), 400, "error");
    }
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetFavouriteTeachers = catchAsync(async (req, res) => {
  try {
    const wishlistResult = await Wishlist.find({
      student: req.user.id,
    }).populate("teacher");

    if (!wishlistResult || wishlistResult.length === 0) {
      return errorResponse(res, "No Teachers found", 404);
    }

    const userIds = wishlistResult
      .map((item) => item.teacher?._id?.toString())
      .filter(Boolean);

    const teacherProfiles = await Teacher.find({ userId: { $in: userIds } });

    const teacherMap = {};
    teacherProfiles.forEach((teacher) => {
      teacherMap[teacher.userId.toString()] = teacher.toObject();
    });

    const enrichedWishlist = wishlistResult.map((item) => {
      const teacherUserId = item.teacher?._id?.toString();
      const extraFields = teacherMap[teacherUserId] || {};
      return {
        ...item.toObject(),
        teacher: {
          ...item.teacher?.toObject?.(),
          ...extraFields,
        },
      };
    });

    return successResponse(
      res,
      "Teachers retrieved successfully.",
      200,
      enrichedWishlist
    );
  } catch (error) {
    console.error("Error in GetFavouriteTeachers:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.reviewUserGet = catchAsync(async (req, res) => {
  const userId = req.user.id;
  try {
    const reviews = await review.find({ userId: userId }).populate({
      path: "lessonId",
      select: "title",
    }).sort({ createdAt: -1 });
    if (!reviews.length) {
      Loggers.warn("No reviews found");
      return validationErrorResponse(res, "No reviews available", 404);
    }
    return successResponse(res, "Reviews retrieved successfully", 200, {
      reviews,
    });
  } catch (error) {
    Loggers.error(error.message);
    return errorResponse(res, "Failed to retrieve reviews", 500);
  }
});

exports.studentDashboard = catchAsync(async (req, res) => {
  const userId = req.user.id;
  try {
    //review
    const reviews = await review
      .find({ userId: userId })
      .populate({
        path: "lessonId",
        select: "title",
      })
      .limit(5)
      .sort({ createdAt: -1 });
    // favrator Techaer
    const wishlistResult = await Wishlist.find({ student: userId })
      .populate("teacher")
      .limit(3)
      .sort({ createdAt: -1 });

    // console.log("wishlistResult", wishlistResult);

    for (let i = 0; i < wishlistResult.length; i++) {
      const teacherId = wishlistResult[i]?.teacher?._id;
      const data = await Teacher.findOne({ userId: teacherId }); 

      if (data) {
        wishlistResult[i] = {
          ...wishlistResult[i].toObject(),
          extra: data
        };
      } else {
        // still convert to object to keep consistency
        wishlistResult[i] = wishlistResult[i].toObject();
      }
    }

    const data = await Bookings.findOne({
      UserId: userId,
      startDateTime: { $gt: new Date() },
      cancelled: false,
    })
      .sort({ startDateTime: 1 })
      // .limit(1)
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('teacherId')
      .populate('LessonId');

    return successResponse(res, "Dashboard retrieved successfully", 200, {
      reviews: reviews,
      wishlistResult: wishlistResult,
      booking: data,
    });

  } catch (error) {
    console.log("error", error);
    return errorResponse(res, "Failed to retrieve reviews", 500);
  }
});

exports.teachergetByID = catchAsync(async (req, res) => {
  try {
    const id = req.params.id;
    const teacher = await Teacher.findById(id).populate("userId");

    if (!teacher) {
      return validationErrorResponse(res, "No teacher found", 400);
    }

    let isLiked = false;

    if (req.user?.id) {
      const wishlistResult = await Wishlist.findOne({
        teacher: teacher.userId._id,
        student: req.user.id,
      });

      if (wishlistResult) {
        isLiked = true;
      }
    }

    const updatedTeacher = {
      ...teacher.toObject(),
      isLiked,
    };

    return successResponse(
      res,
      "Teacher retrieved successfully!",
      200,
      updatedTeacher
    );
  } catch (error) {
    console.log("error", error);
    Loggers.error(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((el) => el.message);
      return validationErrorResponse(res, errors.join(", "), 400, "error");
    }
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetTeacherAvailability = catchAsync(async (req, res) => {
  try {
    const id = req.params.id;
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

      let cursor = aStart;

      for (const booking of matchingBookings) {
        const bStart = new Date(booking.startDateTime);
        const bEnd = new Date(booking.endDateTime);

        if (cursor < bStart) {
          availableSlots.push({
            teacher: id,
            startDateTime: new Date(cursor),
            endDateTime: new Date(bStart),
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

exports.GetLessonsByTeacher = catchAsync(async (req, res) => {
  try {
    const teacherId = req.params.id;
    if (!teacherId) {
      return errorResponse(res, "Teacher ID is required", 400);
    }

    const lessons = await Lesson.find({
      teacher: teacherId,
      is_deleted: { $ne: true }
    }).populate("teacher");

    if (!lessons || lessons.length === 0) {
      return errorResponse(res, "No lessons found", 404);
    }
    const lessonIds = lessons.map(lesson => lesson._id);
    const reviews = await review.find({
      lessonId: { $in: lessonIds },
      review_status: "Accept"
    }).populate("lessonId").populate({
      path: "userId",
      select: "name profile_photo"
    });
    return successResponse(res, "Lessons and accepted reviews retrieved successfully", 200, {
      lessons,
      reviews
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SpecialSlotList = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);
    const { status, search } = req.query;
    const filter = { student: objectId };
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
    // if (search && search.trim() !== "") {
    //   const regex = new RegExp(search.trim(), "i"); // case-insensitive match

    //   data = data.filter((item) => {
    //     const lessonTitle = item?.student?.name || "";
    //     return (
    //       regex.test(lessonTitle)
    //     );
    //   });
    // }
    successResponse(res, "Special Slots retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.SpecialSlotPaymentLink = catchAsync(async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return errorResponse(res, "Special Slot ID is required", 400);
    }

    let data = await SpecialSlot.findById(id)
      .populate("student")
      .populate("teacher")
      .populate("lesson")
      .sort({ startDateTime: -1 });

    if (!data) {
      return errorResponse(res, "Special Slots not Found", 401);
    }

    // Current UTC time
    const nowUtc = moment.utc();

    // Start time in UTC
    const startUtc = moment.utc(data.startDateTime);

    // Difference in minutes
    const diffMinutes = startUtc.diff(nowUtc, 'minutes');

    if (diffMinutes < 10) {
      return errorResponse(res, "Less than 10 minutes are left for start time", 400);
    }

    const token = jwt.sign(
      { id: id },
      process.env.JWT_SECRET_KEY,
      { expiresIn: "48h" }
    );

    const link = `https://akitainakaschoolonline.com/slot/${token}`;
    successResponse(res, "Special Slots retrieved successfully!", 200, { link });
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.BulkLessonCheck = catchAsync(async (req, res) => {
  try {
    const { student, teacher } = req.body;
    const teacherId = teacher ? new mongoose.Types.ObjectId(teacher) : null;
    const teacherData = await Teacher.findById(teacherId);
    if (!teacherData) {
      return errorResponse(res, "Teacher not found", 404);
    }

    let data = await BulkLesson.find({
      UserId: student,
      teacherId: teacherData?.userId,
      lessonsRemaining: { $gt: 0 }
    })
    if (!data) {
      return errorResponse(res, "Special Slots not Found", 401);
    }
    successResponse(res, "Special Slots retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
})

exports.BulkLessonList = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);
    const { status, search } = req.query;
    let data = await BulkLesson.find({ UserId: objectId })
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
      return errorResponse(res, "Special Slots not Found", 401);
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

exports.BulkLessonRedeem = catchAsync(async (req, res) => {
  try {
    const { id, startDateTime, endDateTime, timezone } = req.body;
    
    if(!id || !startDateTime || !endDateTime || !timezone){
      return errorResponse(res, "All fields are required", 400);
    }
    // console.log("id", id);
    // console.log("startDateTime", startDateTime);
    // console.log("endDateTime", endDateTime);
    // console.log("timezone", timezone);

    const data = await BulkLesson.findById(id);
    // console.log("data", data);
    if (!data) {
      return errorResponse(res, "Bulk Lesson not found", 404);
    }

    if (data.lessonsRemaining <= 0) {
    return errorResponse(res, "No lessons remaining to redeem", 400);
    }

    // return successResponse(res, "Special Slots retrieved successfully!", 200);

    // Copy paste yahan se shuru
     let startUTCs, endUTCs;
     startUTCs = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
     endUTCs = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();

    const nowUTC = new Date();

    const timeDiffInMs = startUTCs - nowUTC;
    const timeDiffInMinutes = timeDiffInMs / (1000 * 60);
    if (timeDiffInMinutes < 10) {
      return res.status(400).json({
        status: false,
        error: "Cannot create a booking which starts in less than 10 minutes from now or is in the past"
      });
    }

    // Check for booking conflict for the same teacher
    const existingBooking = await Booking.findOne({
      teacherId: new mongoose.Types.ObjectId(data?.teacherId),
      cancelled: false, // Only consider active bookings
      startDateTime: { $lt: endUTCs },
      endDateTime: { $gt: startUTCs },
    });
    if (existingBooking) {
      return res.status(400).json({
        status: false,
        error: "Booking already exists at the given slot for this teacher.",
      });
    }

    let startUTC, endUTC;
    startUTC = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
    endUTC = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();

    const rate = await Currencies.findOne({ currency: "JPY" });

    const Bookingsave = new Booking({
      teacherId: data?.teacherId,
      totalAmount: data?.totalAmount/data?.totalLessons || 0,
      adminCommission : data?.adminCommission/data?.totalLessons || 0,
      teacherEarning : data?.teacherEarning/data?.totalLessons || 0,
      UserId: data?.UserId,
      LessonId: data?.LessonId,
      paypalpaymentId: null,
      startDateTime: startUTC,
      endDateTime: endUTC,
      processingFee: data?.processingFee/data?.totalLessons || 0,
      isFromBulk: true,
      bulkId: id,
      usdToJpyRate: rate?.rate || 0,
    });
    await Bookingsave.save();

    data.bookings = data.bookings || [];
    data.bookings.push({
      id: Bookingsave._id,
      cancelled: false
    });
    data.lessonsRemaining = data.lessonsRemaining - 1;
    await data.save();

    const user = await User.findById({ _id: req.user.id });
    const teacher = await User.findById({ _id: data?.teacherId });
    logger.info("Paypal Everything done now about to send email");
    logger.info(`Teacher details: ${JSON.stringify(teacher || "")}`);
    const registrationSubject = "Booking Confirmed 🎉";
    const Username = user?.name;

    // Convert to ISO format for moment parsing in email templates
    const utcDateTime = DateTime.fromJSDate(new Date(startUTC), { zone: "utc" });
    const nowTime = DateTime.utc();
    const startUTCDateTime = DateTime.fromJSDate(new Date(startUTC)).toUTC();
    const diffInMinutes = Math.round(
      startUTCDateTime.diff(nowTime, "minutes").minutes
    );
    
    const userTimeISO = user?.time_zone
        ? utcDateTime.setZone(user.time_zone).toISO()
        : utcDateTime.toISO();

      const teacherTimeISO = teacher?.time_zone
        ? utcDateTime.setZone(teacher.time_zone).toISO()
        : utcDateTime.toISO();
      
    const TeacherSubject = "New Booking 🎉";
    const TeacheremailHtml = TeacherBooking(
      teacherTimeISO,
      Username,
      teacher?.name
    );
    logger.info(
      `Bulk booking redeem sending email to teacher at: ${teacher?.email}`
    );
    await sendEmail({
      email: teacher.email,
      subject: TeacherSubject,
      emailHtml: TeacheremailHtml,
    });

    if (diffInMinutes > 30) {
      const emailHtml = BookingSuccess(userTimeISO, Username, teacher?.name);
      logger.info(`Paypal sending email to student at  ${user?.email}`);
      await sendEmail({
        email: user?.email,
        subject: registrationSubject,
        emailHtml: emailHtml,
      });
    } else {
      logger.info(
        `Skipping booking-confirmation email to student for bulk booking because lesson starts in ${diffInMinutes} minutes`
      );
    }
    logger.info("Bulk booking redeem successfull!");
  
    successResponse(res, "Special Slots retrieved successfully!", 200);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.WalletGet = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const objectId = new mongoose.Types.ObjectId(userId);

    const wallet = await Wallet.findOne({ userId: objectId });

    if (!wallet) {
      return successResponse(res, "Wallet retrieved successfully!", 200, {
        balance: 0,
        transactions: [],
      });
    }

    const transactions = await WalletTransaction.find({
      userId: objectId,
    })
      .populate("bookingId")
      .populate("stripePaymentId")
      .populate("paypalPaymentId")
      .sort({ createdAt: -1 })
      .lean();

    const data = {
      balance: wallet.balance,
      transactions,
    };

    return successResponse(res, "Wallet retrieved successfully!", 200, data);
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});
