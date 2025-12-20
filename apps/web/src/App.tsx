import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import PatientList from "./pages/PatientList";
import PatientProfile from "./pages/PatientProfile";
import ScanViewer from "./pages/ScanViewer";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<PatientList />} />
        <Route path="/patients/:id" element={<PatientProfile />} />
        <Route path="/patients/:id/scans/:scanId" element={<ScanViewer />} />
      </Route>
    </Routes>
  );
}
