
import { Link } from '@tanstack/react-router';

export function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold mb-4">Welcome to Your New App</h1>
      <p className="text-lg text-gray-600 mb-8">
        This is a landing page.
      </p>
      <Link
        to="/home"
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Go to Home
      </Link>
    </div>
  );
}
