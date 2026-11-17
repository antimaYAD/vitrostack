import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { Lock } from "lucide-react";
import Layout from "./components/Layout";
import { Button, EmptyState, Skeleton } from "./components/ui";
import { AuthProvider, RequireAdmin, RequireAuth } from "./lib/auth";
import Overview from "./pages/Overview";
import Copilot from "./pages/Copilot";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Engineering from "./pages/Engineering";
import Inventory from "./pages/Inventory";
import SiteOps from "./pages/SiteOps";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin";
import AdminUsers from "./pages/AdminUsers";
import Login from "./pages/Login";
import Register from "./pages/Register";

// The canvas pulls in Konva (~300 kB), so the designer loads on demand.
const FacadeStudio = lazy(() => import("./pages/FacadeStudio"));

/** /facade was the designer's address before the two design pages were merged. */
function ToDesigner() {
  const { search } = useLocation();
  return <Navigate to={`/designer${search}`} replace />;
}

function Forbidden() {
  return (
    <EmptyState icon={<Lock className="h-6 w-6" />} title="Admins only" body="Your account doesn't have access to this area. Ask an admin if you need it."
      action={<Link to="/"><Button>Back to overview</Button></Link>} />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="copilot" element={<Copilot />} />
          <Route path="copilot/:sessionId" element={<Copilot />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="engineering" element={<Engineering />} />
          <Route path="designer" element={<Suspense fallback={<Skeleton className="h-[600px] rounded-2xl" />}><FacadeStudio /></Suspense>} />
          <Route path="facade" element={<ToDesigner />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="site" element={<SiteOps />} />
          <Route path="admin" element={<Navigate to="/admin/pricing" replace />} />
          <Route path="admin/pricing" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
          <Route path="forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster richColors position="bottom-right" closeButton />
    </AuthProvider>
  );
}
