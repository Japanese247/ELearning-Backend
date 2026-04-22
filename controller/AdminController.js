const Teacher = require("../model/teacher");
const User = require("../model/user");
const Payout = require("../model/Payout");
const Bookings = require("../model/booking");
const catchAsync = require("../utils/catchAsync");
const { errorResponse, successResponse } = require("../utils/ErrorHandling");
const Payouts = require("../model/Payout");
const Lessons = require("../model/lesson");
const Review = require("../model/review");
const Bonus = require("../model/Bonus");
const Bank = require("../model/Bank");
const Currency = require("../model/Currency");
const AdminCourse = require("../model/AdminCourse");
const TeacherApprove = require("../EmailTemplate/TeacherApprove");
const AdminBulkUpdateTemplate = require("../EmailTemplate/AdminBulkUpdateTemplate");
const sendEmail = require("../utils/EmailMailler");
const jwt = require("jsonwebtoken");
const logger = require("../utils/Logger");
const { uploadFileToSpaces, deleteFileFromSpaces } = require("../utils/FileUploader");
const BulkLesson = require("../model/bulkLesson");


const signEmail = async (id) => {
  const token = jwt.sign({ id }, process.env.JWT_SECRET_KEY, {
    expiresIn: "24h",
  });
  return token;
};

exports.TeacherList = catchAsync(async (req, res) => {
  try {
    const { search, block } = req.query;
    const userQuery = {};
    if (block) {
      userQuery.block = block;
    }
    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search, "i");
      userQuery.$or = [{ name: searchRegex }, { email: searchRegex }];
    }
    const teacherQuery = {};
    if (Object.keys(userQuery).length > 0) {
      const matchedUsers = await User.find(userQuery).select("_id");
      const userIds = matchedUsers.map((user) => user._id);
      teacherQuery.userId = { $in: userIds };
    }

    const [approvedTeachers, rejectedTeachers, pendingApproval] =
      await Promise.all([
        Teacher.find({ ...teacherQuery, admin_approved: true }).populate(
          "userId"
        ),
        Teacher.find({ ...teacherQuery, admin_approved: false }).populate(
          "userId"
        ),
        Teacher.find({ ...teacherQuery, admin_approved: null }).populate(
          "userId"
        ),
      ]);

    return successResponse(res, "Teachers retrieved successfully", 200, {
      approvedTeachers,
      rejectedTeachers,
      pendingApproval,
    });

  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.ApproveRejectTeacher = catchAsync(async (req, res) => {
  try {
    const { id, approved } = req.body;
    const teacher = await Teacher.findByIdAndUpdate(
      id,
      { admin_approved: approved },
      { new: true }
    ).populate('userId', 'name email');
    if (approved) {
      const token = await signEmail(teacher.userId);
      const link = `https://akitainakaschoolonline.com/verify/${token}`;
      const registrationSubject =
        "Your Account Has Been Approved! 🎉";
      const emailHtml = TeacherApprove(teacher?.userId?.name || "", link);
      await sendEmail({
        email: teacher?.userId?.email,
        subject: registrationSubject,
        emailHtml: emailHtml,
      });
    }
    if (!teacher) {
      return errorResponse(res, "Teacher not found", 404);
    }
    if (approved) {
      return successResponse(res, "Teacher approved successfully", 200, teacher);
    }
    else {
      return successResponse(res, "Teacher rejected successfully", 200, teacher);
    }
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.StudentList = catchAsync(async (req, res) => {
  const { search = "", block = "" } = req.query;

  try {
    const query = { role: "student" };
    if (search && search.trim() !== "") {
      const regex = { $regex: search.trim(), $options: "i" };
      query.$or = [{ name: regex }, { email: regex }];
    }
    if (block === "true") {
      query.block = true;
    } else if (block === "false") {
      query.block = false;
    }
    const students = await User.find(query);

    return successResponse(res, "Students retrieved successfully", 200, students);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.DeleteUser = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return errorResponse(res, "User ID is required", 400);
  }

  const user = await User.findById(id);
  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  const timestamp = Date.now();
  user.deleted_at = new Date();
  user.email = `email_deleted_${timestamp}`;

  await user.save();

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
  });
});

exports.AdminBlockUser = catchAsync(async (req, res) => {
  try {
    const { id } = req.body;
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { block: !user.block },
      { new: true }
    );
    return successResponse(res, "User block status updated successfully", 200, updatedUser);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.PayoutListing = catchAsync(async (req, res) => {
  try {
    const { search, status } = req.query;
    const filter = {};
    if (status && status != "") {
      filter.Status = status;
    }
    let result = await Payout.find(filter)
      .sort({ createdAt: -1 })
      .populate("BankId")
      .populate("userId");
    if (result.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No payouts found.",
      });
    }

    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i");

      result = result.filter((item) => {
        const teacherName = item?.userId?.name || "";

        return (
          regex.test(teacherName)
        );
      });
    }

    const rateDoc = await Currency.findOne({ currency: "JPY" });
    const currentJpyRate = Number(rateDoc?.rate || 0) || 0;
    if (currentJpyRate > 0) {
      const payoutIdsToFix = [];
      for (const payout of result) {
        if (payout?.Status !== "pending") continue;
        const usd = Number(payout?.amount || 0) || 0;
        const jpy = Number(payout?.amountInJpy || 0) || 0;
        if (!usd) continue;
        const effectiveRate = jpy / usd;
        if (!jpy || effectiveRate < 90 || effectiveRate > 300) {
          payout.amountInJpy = Math.round(usd * currentJpyRate);
          payoutIdsToFix.push(payout._id);
        }
      }
      if (payoutIdsToFix.length) {
        await Payout.updateMany(
          { _id: { $in: payoutIdsToFix }, Status: "pending" },
          [
            {
              $set: {
                amountInJpy: {
                  $round: [{ $multiply: ["$amount", currentJpyRate] }, 0],
                },
              },
            },
          ]
        );
      }
    }

    return res.status(200).json({
      status: true,
      message: "Payouts retrieved successfully.",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve bank records.",
      error: error.message,
    });
  }
});

exports.PayoutAcceptorReject = catchAsync(async (req, res) => {
  try {
    const payoutId = req.params.id;
    if (!payoutId) {
      return res.status(400).json({
        status: false,
        message: "Payout ID is missing.",
      });
    }

    const { status, reason, transactionId } = req.body;

    if (!status) {
      return res.status(400).json({
        status: false,
        message: "Please send a status.",
      });
    }

    if (status === "approved" && !transactionId) {
      return res.status(400).json({
        status: false,
        message: "Transaction id is required.",
      });
    }

    if (status === "rejected" && !reason) {
      return res.status(400).json({
        status: false,
        message: "Reason is required for rejection.",
      });
    }

    const payout = await Payout.findById(payoutId);
    if (!payout) {
      return res.status(404).json({
        status: false,
        message: "Payout not found.",
      });
    }

    // Update payout
    payout.Status = status;
    payout.TransactionId = transactionId || null;
    payout.Reasons = reason || null;
    await payout.save();

    let updatedBookings, updatedBonus;

    if (status === "approved") {
      updatedBookings = await Bookings.updateMany(
        { payoutCreationDate: payout.createdAt },
        { payoutDoneAt: new Date() }
      );
      updatedBonus = await Bonus.updateMany(
        { payoutCreationDate: payout.createdAt },
        { payoutDoneAt: new Date() }
      );
    } else if (status === "rejected") {
      updatedBookings = await Bookings.updateMany(
        { payoutCreationDate: payout.createdAt },
        { payoutCreationDate: null }
      );
      updatedBonus = await Bonus.updateMany(
        { payoutCreationDate: payout.createdAt },
        { payoutCreationDate: null }
      );
    }

    return res.status(200).json({
      status: true,
      message: `Payout ${status} successfully.`,
      updatedBookingsCount: updatedBookings?.modifiedCount || 0,
    });
  } catch (error) {
    console.log("error", error);
    Loggers.error("Error in PayoutAcceptorReject:", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Internal server error",
    });
  }
});

exports.AdminBookingsGet = catchAsync(async (req, res) => {
  try {
    const { search } = req.query;
    let data = await Bookings.find({}).sort({ startDateTime: -1 })
      .populate('StripepaymentId')
      .populate('paypalpaymentId')
      .populate('UserId')
      .populate('teacherId')
      .populate('LessonId')
      .populate('zoom')
      .populate('ReviewId')
      .populate('BonusId');
    if (!data) {
      return errorResponse(res, "Bookings not Found", 401);
    }

    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i"); // case-insensitive match

      data = data.filter((item) => {
        const lessonTitle = item.LessonId?.title || "";
        const teacherName = item?.teacherId?.name || "";
        const studentName = item?.UserId?.name || "";

        return (
          regex.test(lessonTitle) ||
          regex.test(teacherName) ||
          regex.test(studentName)
        );
      });
    }
    successResponse(res, "Bookings retrieved successfully!", 200, data);
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.AdminEarning = catchAsync(async (req, res) => {
  try {
    const { date, search, page, limit = 15, exportAll } = req.query;
    const filter = { cancelled: false, isFromBulk: { $ne: true } };
    if (date) {
      const now = new Date();
      if (date === "last7") {
        const from = new Date();
        from.setDate(now.getDate() - 7);
        filter.createdAt = { $gte: from, $lte: now };
      } else if (date === "last30") {
        const from = new Date();
        from.setDate(now.getDate() - 30);
        filter.createdAt = { $gte: from, $lte: now };
      } else if (!isNaN(date)) {
        const year = parseInt(date, 10);
        const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
        const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);
        filter.createdAt = { $gte: startOfYear, $lte: endOfYear };
      }
    }
    let count = await Bookings.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$totalAmount" },
          teacherEarning: { $sum: "$teacherEarning" },
          adminCommission: { $sum: "$adminCommission" },
          processingFee: { $sum: "$processingFee" }
        }
      }
    ]);

    if (!count.length) {
      count = [{
        totalAmount: 0,
        teacherEarning: 0,
        adminCommission: 0,
        processingFee: 0,
        bonus: 0
      }];
    }

    const totalBookings = await Bookings.countDocuments(filter); // <— total records
    const currentPage = parseInt(page);
    const perPage = parseInt(limit);
    const totalPages = Math.ceil(totalBookings / perPage);
    const skip = (currentPage - 1) * perPage;
    let queryBuilder;
    if (search && search.trim() !== "") {
      queryBuilder = Bookings.find(filter).sort({ startDateTime: -1 })
        .populate('StripepaymentId')
        .populate('paypalpaymentId')
        .populate('UserId')
        .populate('teacherId')
        .populate('LessonId');
    }
    else {
      queryBuilder = Bookings.find(filter).sort({ startDateTime: -1 })
        .populate('StripepaymentId')
        .populate('paypalpaymentId')
        .populate('UserId')
        .populate('teacherId')
        .populate('LessonId');

    }
    if (!exportAll) {
      queryBuilder = queryBuilder.skip(skip).limit(parseInt(limit));
    }
    let bookings = await queryBuilder;

    let bulkFilter = {};
    if (filter.createdAt) bulkFilter.createdAt = filter.createdAt;

    const bulkAgg = await BulkLesson.aggregate([
      { $match: bulkFilter },
      {
        $group: {
          _id: null,
          bulkTotalAmount: { $sum: { $toDouble: "$totalAmount" } },
          bulkTeacherEarning: { $sum: { $toDouble: "$teacherEarning" } },
          bulkProcessingFee: { $sum: { $toDouble: "$processingFee" } },
          bulkAdminCommission: { $sum: { $toDouble: "$adminCommission" } }
        }
      }
    ]);

    const bulk = bulkAgg.length > 0
      ? bulkAgg[0]
      : { bulkTotalAmount: 0, bulkTeacherEarning: 0, bulkProcessingFee: 0 };

    const bulkPurchases = await BulkLesson.find()
      .populate("UserId")
      .populate("teacherId")
      .populate("LessonId")
      .populate("StripepaymentId")
      .populate("paypalpaymentId")
      .populate({
        path: "bookings.id",
        model: "Bookings"
      })
      .sort({ createdAt: -1 })

    const bonus = await Bonus.aggregate([
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" }
        }
      }
    ]);

    const totalBonus = bonus.length > 0 ? bonus[0].totalAmount : 0;
    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i"); // case-insensitive match

      bookings = bookings.filter((item) => {
        const lessonTitle = item.LessonId?.title || "";
        const stripeId = item.StripepaymentId?.payment_id || "";
        const paypalId = item.paypalpaymentId?.orderID || "";
        const studentName = item?.UserId?.name || "";
        const teacherName = item?.teacherId?.name || "";

        return (
          regex.test(lessonTitle) ||
          regex.test(stripeId) ||
          regex.test(paypalId) ||
          regex.test(studentName) ||
          regex.test(teacherName)
        );
      });
    }
    if (!bookings) {
      return errorResponse(res, "Bookings not Found", 401);
    }
    // console.log("count[0] before", count[0]);
    count[0].totalAmount = count[0].totalAmount + totalBonus - count[0].processingFee + bulk.bulkTotalAmount - bulk.bulkProcessingFee;
    count[0].teacherEarning += totalBonus + bulk.bulkTeacherEarning;
    count[0].bonus = totalBonus;
    count[0].adminCommission += bulk.bulkAdminCommission;

    // console.log("bulk", bulk);
    // console.log("totalBonus", totalBonus);
    // console.log("count[0] after", count[0]);
    successResponse(res, "Bookings retrieved successfully!", 200, {
      count: count[0],
      bookings,
      bulkPurchases,
      pagination: {
        currentPage,
        totalPages,
        totalBookings,
        limit: perPage
      },
    });
  } catch (error) {
    console.log("error", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.TeacherAllData = catchAsync(async (req, res) => {
  try {
    const id = req.params.id;
    const record = await Teacher.findOne({ userId: id }).populate("userId");
    const Booking = await Bookings.find({
      teacherId: id,
      lessonCompletedStudent: true,
      lessonCompletedTeacher: true
    }).populate([
      { path: "teacherId" },
      { path: "UserId" },
      { path: "LessonId" },
      { path: "zoom" },
      { path: "BonusId" },
    ]).sort({ createdAt: -1 });

    const payoutdata = await Payouts.find({ userId: id });
    const lessondata = await Lessons.find({ teacher: id }).sort({ is_deleted: 1 });
    const bankdata = await Bank.findOne({ userId: id });
    const reviews = await Review.find()
      .populate({
        path: "lessonId",
        select: "teacher title description",
      })
      .populate("userId").sort({ createdAt: -1 });

    const filteredReviews = reviews.filter(
      (review) =>
        review.lessonId?.teacher?._id?.toString() === id
    );
    if (!record) {
      return errorResponse(res, "Teacher not found", 404);
    }
    successResponse(res, "Teacher retrieved successfully!", 200, { record, Booking, lessondata, payoutdata, filteredReviews, bankdata });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.Admindashbaord = catchAsync(async (req, res) => {
  try {
    const countstudent = await User.countDocuments({ role: "student", block: false, email_verify: true });
    const Countteacher = await Teacher.countDocuments({ admin_approved: true })
    const pendingreview = await Review.countDocuments({ review_status: "Pending" })
    const totalbooking = await Bookings.countDocuments({ lessonCompletedStudent: true, lessonCompletedTeacher: true });
    const TeacherData = await Teacher.find({ admin_approved: true }).limit(5).populate("userId");
    const ReviewData = await Review.find({}).populate("userId").populate("lessonId").sort({ createdAt: -1 }).limit(5);
    return successResponse(res, "Admin Dashboard Data Get", 200, {
      ReviewData, countstudent, Countteacher, pendingreview, TeacherData, totalbooking
    });
  } catch (error) {
    console.log("error", error)
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
})

exports.AistrainedApprove = catchAsync(async (req, res) => {
  try {
    const { id } = req.body;
    const user = await Teacher.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }
    // toggle ais_trained
    const newStatus = user.ais_trained === true ? false : true;
    const teacher = await Teacher.findByIdAndUpdate(
      id,
      { ais_trained: newStatus },
      { new: true }
    );
    if (!teacher) {
      return errorResponse(res, "Teacher not found.", 404);
    }
    const message = teacher.ais_trained === true
      ? "Teacher has been successfully marked as AIS-trained."
      : "Teacher has been successfully marked as not AIS-trained.";

    return successResponse(res, message, 200, teacher);
  } catch (error) {
    console.error("Error:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.ApproveEnglishSupport = catchAsync(async (req, res) => {
  try {
    const { id, status } = req.body;
    const allowedStatuses = ["approved", "rejected"];
    if (!allowedStatuses.includes(status)) {
      return errorResponse(res, "Invalid status value", 400);
    }
    const teacher = await Teacher.findById(id);
    if (!teacher) {
      return errorResponse(res, "Teacher not found", 404);
    }

    // ✅ Only allow action if currently pending
    if (teacher.englishSupportStatus !== "pending") {
      return errorResponse(
        res,
        "Only pending requests can be updated",
        400
      );
    }
    if (status === "approved") {
      if (!teacher.languages_spoken.includes("English")) {
        teacher.languages_spoken.push("English");
      }
    }

    teacher.englishSupportStatus = status;
    await teacher.save();
    const message =
      status === "approved"
        ? "English support approved successfully"
        : "English support rejected successfully";

    return successResponse(res, message, 200, teacher);
  } catch (error) {
    console.error("Error:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateTeacherVideo = catchAsync(async (req, res) => {
  try {
    const { id, link } = req.body;
    const user = await Teacher.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }
    const teacher = await Teacher.findByIdAndUpdate(
      id,
      { intro_video: link },
      { new: true }
    );
    if (!teacher) {
      return errorResponse(res, "Teacher not found.", 404);
    }
    logger.info(`Admin updated intro video for teacher ID: ${id} link: ${link}`);
    return successResponse(res, "Teacher intro video updated succesfully", 200, teacher);
  } catch (error) {
    console.error("error:", error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateFeaturedTeachers = catchAsync(async (req, res) => {
  try {
    const { featured } = req.body;
    if (!Array.isArray(featured)) {
      return errorResponse(res, "Invalid input format", 400);
    }
    await Teacher.updateMany({}, { $set: { featured: null } });
    for (const { _id, number } of featured) {
      if (_id && number) {
        await Teacher.findByIdAndUpdate(_id, { $set: { featured: number } });
      }
    }
    const updatedTeachers = await Teacher.find({});
    return successResponse(res, "Featured teachers updated successfully", 200, {
      data: updatedTeachers,
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateTeacherRank = catchAsync(async (req, res) => {
  try {
    const { rank } = req.body;
    if (!Array.isArray(rank)) {
      return errorResponse(res, "Invalid input format", 400);
    }
    await Teacher.updateMany({}, { $set: { rank: null } });
    for (const { _id, number } of rank) {
      if (_id && number) {
        await Teacher.findByIdAndUpdate(_id, { $set: { rank: number } });
      }
    }
    const updatedTeachers = await Teacher.find({});
    return successResponse(res, "Teachers rank updated successfully", 200, {
      data: updatedTeachers,
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetRankedTeachers = catchAsync(async (req, res, next) => {
  try {
    const teachers = await Teacher.find({ rank: { $ne: null } })
      .sort({ rank: 1 })
      .select("_id rank")
      .lean();

    return successResponse(
      res,
      "Teachers fetched with reviews and lessons",
      200,
      teachers,
    );
  } catch (error) {
    logger.error(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.AddCourse = catchAsync(async (req, res) => {
  try {
    const { title, description, link } = req.body;
    if (!title || !description || !link) {
      return errorResponse(res, "All fields are required", 400);
    }
    if (!req.file) {
      return errorResponse(res, "Image is required", 400);
    }
    let thumbnail = null;
    if (req.file) {
      const fileKey = await uploadFileToSpaces(req.file);
      thumbnail = fileKey;
    }
    const courseRecord = new AdminCourse({
      title,
      description,
      thumbnail,
      link,
    });
    const courseResult = await courseRecord.save();
    if (!courseResult) {
      return errorResponse(res, "Failed to add course.", 500);
    }
    return successResponse(res, "course added successfully", 201);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.getCourse = catchAsync(async (req, res) => {
  try {
    const data = await AdminCourse.find({});
    if (!data) {
      return errorResponse(res, "No course found", 200);
    }
    return successResponse(res, "Courses fetched successfully", 200, data);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.UpdateCourse = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, link } = req.body;
    if (!id) {
      return errorResponse(res, "Course ID is required", 400);
    }
    if (!title || !description || !link) {
      return errorResponse(res, "All fields are required", 400);
    }
    // ✅ Find existing course
    const course = await AdminCourse.findById(id);
    if (!course) {
      return errorResponse(res, "Course not found", 404);
    }

    // ✅ Handle image upload (optional)
    let thumbnail = course.thumbnail;
    if (req.file) {
      if (course.thumbnail) {
        const isDeleted = await deleteFileFromSpaces(course.thumbnail);
        if (!isDeleted) {
          return res.status(500).json({
            status: false,
            message: "Unable to delete old profile photo",
          });
        }
      }
      const fileKey = await uploadFileToSpaces(req.file);
      thumbnail = fileKey;
    }

    // ✅ Update the course
    course.title = title;
    course.description = description;
    course.link = link;
    course.thumbnail = thumbnail;

    const updatedCourse = await course.save();

    if (!updatedCourse) {
      return errorResponse(res, "Failed to update course.", 500);
    }

    return successResponse(res, "Course updated successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.deleteCourse = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "Course ID is required", 400);
    }
    const course = await AdminCourse.findById(id);
    if (!course) {
      return errorResponse(res, "Course not found", 404);
    }
    if (course.is_deleted) {
      course.is_deleted = false;
    }
    else {
      course.is_deleted = true;
    }
    const updatedCourse = await course.save();
    if (!updatedCourse) {
      return errorResponse(res, "Failed to delete course", 500);
    }

    return successResponse(res, "Course updated successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.emulateUser = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "User id is required", 400);
    }
    // console.log("req.user", req.user);
    if (req.user.role != "admin") {
      return errorResponse(res, "Only admin can emulate users", 403);
    }
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }
    // if (!user?.email_verify) {
    //   return errorResponse(res, "Cannot emulate users where email is not verified", 200);
    // }
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        time_zone: user.time_zone,
        email: user.email,
      },
      process.env.JWT_SECRET_KEY,
      { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
    );
    return res.status(200).json({
      status: true,
      message: "Emulation successful",
      token,
      role: user.role,
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.updateBulkByAdmin = catchAsync(async (req, res) => {
  try {
    const { bulkId } = req.params;
    const {
      actionType,
      lessonsChanged,
      refundAmount,
      status,
      reason,
      sendNotification
    } = req.body;

    if (!bulkId) {
      return res.status(400).json({ message: "Bulk Id is required" });
    }

    const bulk = await BulkLesson.findById(bulkId).populate("teacherId").populate("UserId").populate("LessonId");

    if (!bulk) {
      return res.status(404).json({ message: "Bulk not found" });
    }

    let updateData = {};
    let adjustmentRecord = null;

    // 1️⃣ Adjust Credits
    if (actionType === "adjust_credits") {

      if (!lessonsChanged || !reason) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      if (bulk.lessonsRemaining + lessonsChanged < 0) {
        return res.status(400).json({ message: "Lessons remaining cannot be negative" });
      }

      updateData.$inc = {
        lessonsRemaining: lessonsChanged,
        totalLessons: lessonsChanged > 0 ? lessonsChanged : 0
      };

      adjustmentRecord = {
        type: lessonsChanged > 0 ? "credit_add" : "credit_deduct",
        lessonsChanged,
        amountChanged: 0,
        reason,
        adminId: req.user._id
      };
    }

    // 2️⃣ Refund
    if (actionType === "refund") {

      if (!refundAmount || !reason) {
        return res.status(400).json({ message: "Refund amount and reason required" });
      }

      updateData.status =
        refundAmount === bulk.totalAmount
          ? "refunded"
          : "partially_refunded";

      updateData.$inc = {
        lessonsRemaining: -Math.abs(lessonsChanged || 0)
      };

      updateData.refundAmount =
        (bulk.refundAmount || 0) + refundAmount;

      adjustmentRecord = {
        type: "manual_refund",
        lessonsChanged: -Math.abs(lessonsChanged || 0),
        amountChanged: refundAmount,
        reason,
        adminId: req.user._id
      };
    }

    // 3️⃣ Cancel
    if (actionType === "cancel") {
      updateData.status = "cancelled";
      updateData.lessonsRemaining = 0;

      adjustmentRecord = {
        type: "cancel",
        lessonsChanged: -bulk.lessonsRemaining,
        amountChanged: 0,
        reason,
        adminId: req.user._id
      };
    }

    if (adjustmentRecord) {
      updateData.$push = {
        adminAdjustments: adjustmentRecord
      };
    }

    await BulkLesson.updateOne(
      { _id: bulkId, adminAdjustments: null },
      { $set: { adminAdjustments: [] } }
    );

    const updatedBulk = await BulkLesson.findByIdAndUpdate(
      bulkId,
      updateData,
      { new: true }
    );

    // Send notification if requested
    if (sendNotification) {
      const student = await User.findById(bulk.UserId);

      await sendEmail({
        email: student.email,
        subject: "Update Regarding Your Bulk Lessons",
        emailHtml: AdminBulkUpdateTemplate(
          student.name,
          actionType,
          reason,
          bulk?.teacherId?.name || "",
          bulk?.LessonId?.title || "",
          lessonsChanged,
          refundAmount
        )
      });
    }
    return successResponse(res, "Bulk booking updated successfully", 200, updatedBulk);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
