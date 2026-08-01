import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import FileUpload from "@/components/FileUpload";
import MergeWorkspace from "@/components/MergeWorkspace";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<FileUpload />} />
        <Route path="/merge" element={<MergeWorkspace />} />
      </Routes>
    </Router>
  );
}
