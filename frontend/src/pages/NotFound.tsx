
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-4">
        <h1 className="text-8xl md:text-9xl font-bold text-primary">404</h1>
        <p className="text-2xl md:text-3xl font-semibold mt-4">Oops! Page not found</p>
        <p className="text-muted-foreground mt-2 max-w-md mx-auto">
          The page you are looking for does not exist, has been moved, or is under construction.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
