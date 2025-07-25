const router = require("express").Router();
const { BankAddOrEdit, BankList } = require("../controller/BankController");
const { PayoutAdd, payoutList } = require("../controller/PayoutController");
const { AddAvailability, UpdateAvailability, GetLessons, GetAvailability, RemoveAvailability, UploadCheck, DeleteCheck, TeacherGet, EarningsGet, BookingsGet, updateProfile, DashboardApi, SpecialSlotCreate, StudentLessonListing, SpecialSlotList, SpecialSlotData, DeleteGetLesson, GetReview, EmailCheck } = require("../controller/teacherController");
const { verifyToken } = require("../middleware/tokenVerify");
const { upload } = require("../utils/FileUploader");

router.post("/teacher/availability/add", verifyToken, AddAvailability);

router.put("/teacher/availability/update/:id", verifyToken, UpdateAvailability);

router.delete("/teacher/availability/delete/:id", verifyToken, RemoveAvailability);

router.get("/teacher/availability/get", verifyToken, GetAvailability);

router.get("/teacher/lesson/get", verifyToken, GetLessons);

router.post("/teacher/lesson/delete", verifyToken, DeleteGetLesson);

// The below 3 are test routes only don't use them
router.post("/teacher/test/upload", upload.single('file'), UploadCheck);

router.post("/teacher/test/delete", DeleteCheck);

router.post("/teacher/test/email", EmailCheck);

router.post("/teacher/payout", verifyToken, PayoutAdd);

router.get("/teacher/payout", verifyToken, payoutList);

router.post("/teacher/bank", verifyToken, BankAddOrEdit);

router.get("/teacher/bank", verifyToken, BankList);

router.get("/teacher/profile", verifyToken, TeacherGet);

router.post("/teacher/profile", verifyToken, upload.fields([
  { name: 'profile_photo', maxCount: 1 },
  { name: 'documentlink', maxCount: 1 },
]), updateProfile);

router.get("/teacher/earning", verifyToken, EarningsGet);

router.get("/teacher/booking", verifyToken, BookingsGet);

router.get("/teacher/dashboard", verifyToken, DashboardApi);

// Special slot Create
router.post("/teacher/specialSlot", verifyToken, SpecialSlotCreate);
router.get("/teacher/specialSlot", verifyToken, SpecialSlotList);
router.get("/teacher/specialSlotdata/:token", SpecialSlotData);
//The below route is used fopr getting student and lessons listing for special slot creation  
router.get("/teacher/studentLesson", verifyToken, StudentLessonListing);

router.get("/teacher/review", verifyToken, GetReview);



module.exports = router;