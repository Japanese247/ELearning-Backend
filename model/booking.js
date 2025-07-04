const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher id is required"],
    },
    UserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Student id is required"],
    },
    LessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: [true, "Lesson id is required"],
    },
    paypalpaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "paypalpayments"
    },
    StripepaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "stripepayments",
    },
    ReviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "review",
      default: null,
    },
    startDateTime: {
      type: Date,
      required: true,
    },
    endDateTime: {
      type: Date,
      required: true,
    },
    lessonCompletedStudent: {
      type: Boolean,
      // default: false,
      default: true,
    },
    lessonCompletedTeacher: {
      type: Boolean,
      default: false,
    },
    cancelled: {
      type: Boolean,
      default: false,
    },
    rescheduled: {
      type: Boolean,
      default: false,
    },
    totalAmount: {
      type: Number,
      required: [true, "Amount is required"],
    },
    teacherEarning: {
      type: Number,
      required: [true, "Teacher Earning is required"],
    },
    adminCommission: {
      type: Number,
      required: [true, "Admin Commission is required"],
    },
    processingFee: {
      type: Number,
      required: [true, "Processing Fee is required"],
    },
    payoutCreationDate: {
      type: Date,
      default: null,
    },
    payoutDoneAt: {
      type: Date,
      default: null,
    },
    // Zoom meeting link
    zoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zoom",
      default: null,
    },
    IsBonus: { type: Boolean, default: false },
     BonusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "bonus",
      default: null,
    },
  },
  { timestamps: true }
);

const Bookings = mongoose.model("Bookings", bookingSchema);
module.exports = Bookings;