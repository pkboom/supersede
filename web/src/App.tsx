import { Navigate, Route, Routes } from "react-router-dom";
import { TemplateEmpty } from "./routes/TemplateEmpty.js";
import { TemplateRoute } from "./routes/TemplateRoute.js";
import { Settings } from "./settings/Settings.js";
import { SidebarShell } from "./sidebar/SidebarShell.js";
import { Toaster } from "./ui/Toaster.js";

export function App() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/" element={<Navigate to="/templates" replace />} />
        <Route element={<SidebarShell />}>
          <Route path="/templates" element={<TemplateEmpty />} />
          <Route path="/templates/:id" element={<TemplateRoute />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/templates" replace />} />
      </Routes>
    </>
  );
}
