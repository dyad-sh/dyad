import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import StockImagesPage from "@/pages/stock-images";

export const stockImagesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library/stock",
  component: StockImagesPage,
});
