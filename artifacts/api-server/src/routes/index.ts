import { Router, type IRouter } from "express";
import healthRouter from "./health";
import courseMediaRouter from "./course-media";
import adminLearnersRouter from "./admin-learners";

const router: IRouter = Router();

router.use(healthRouter);
router.use(courseMediaRouter);
router.use(adminLearnersRouter);

export default router;
