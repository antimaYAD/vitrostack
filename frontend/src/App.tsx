import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { Lock } from "lucide-react";
import Layout from "./components/Layout";
import { Button, EmptyState, Skeleton } from "./components/ui";
import { AuthProvider, RequireAdmin, RequireAuth, RequireEditor, RequireSuperadmin } from "./lib/auth";
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
import Platform from "./pages/Platform";

// The canvas pulls in Konva (~300 kB), so the designer loads on demand.
const FacadeStudio = lazy(() => import("./pages/FacadeStudio"));

/** /facade was the designer's address before the two design pages were merged. */
function ToDesigner() {
  const { search } = useLocation();
  return <Navigate to={`/designer${search}`} replace />;
}

function Forbidden() {
  return (
    <EmptyState icon={<Lock className="h-6 w-6" />} title="Not available for your role" body="Your account doesn't have access to this area. Ask your company admin if you need it."
      action={<Link to="/"><Button>Back to overview</Button></Link>} />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        {/* No self sign-up: the superadmin creates companies, company admins create their users. */}
        <Route path="register" element={<Navigate to="/login" replace />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="platform" element={<RequireSuperadmin><Platform /></RequireSuperadmin>} />
          <Route path="copilot" element={<RequireEditor><Copilot /></RequireEditor>} />
          <Route path="copilot/:sessionId" element={<RequireEditor><Copilot /></RequireEditor>} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="engineering" element={<Engineering />} />
          <Route path="designer" element={<Suspense fallback={<Skeleton className="h-[600px] rounded-2xl" />}><FacadeStudio /></Suspense>} />
          <Route path="facade" element={<ToDesigner />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="site" element={<RequireEditor><SiteOps /></RequireEditor>} />
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
