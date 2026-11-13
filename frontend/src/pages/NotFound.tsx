import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button, EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState icon={<Compass className="h-6 w-6" />} title="Page not found" body="The page you're looking for doesn't exist or was moved."
      action={<Link to="/"><Button>Back to overview</Button></Link>} />
  );
}
