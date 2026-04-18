const mongoose = require("mongoose");


const bonusSchema = new  mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User ID is required."],
    },
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "Teacher ID is required."],
    },
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Bookings",
        required: [true, "Booking ID is required."],
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
    amount: {
        type: Number,
        default: 0
    },
    Currency: {
        type: String,
        default: "USD"
    },
    conversion_rate: {
        type: Number,
        default: 0
    },
    usdToJpyRate: {
      type: Number,
      default: 0,
    },
    payoutCreationDate: {
      type: Date,
      default: null,
    },
    payoutDoneAt: {
      type: Date,
      default: null,
    },
    paypalpaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "paypalpayments"
    },
    StripepaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "stripepayments",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("bonus", bonusSchema);
