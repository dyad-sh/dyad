
import { Route } from '@tanstack/react-router';
import { rootRoute } from './root';
import { LandingPage } from '../pages/landing';

export const landingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});
