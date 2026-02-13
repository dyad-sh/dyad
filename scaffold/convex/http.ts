import { auth } from "./auth";
import router from "./router";

const http = router;

auth.addHttpRoutes(http);

export default http;
