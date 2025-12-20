import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet, Scan } from "../api";

export default function ScanViewer() {
  const { id, scanId } = useParams();
  const patientId = id ?? "";
  const scanKey = scanId ?? "";

  const scanQuery = useQuery({
    queryKey: ["scan", scanKey],
    queryFn: () => apiGet<Scan>(`/scans/${scanKey}`),
    enabled: Boolean(scanKey)
  });

  if (!scanKey) {
    return (
      <div className="card">
        <p className="small">Missing scan ID.</p>
      </div>
    );
  }

  if (scanQuery.isLoading) {
    return (
      <div className="card">
        <p className="small">Loading scan...</p>
      </div>
    );
  }

  if (scanQuery.error || !scanQuery.data) {
    return (
      <div className="card">
        <p className="small">Scan not found.</p>
      </div>
    );
  }

  const scan = scanQuery.data;

  return (
    <div className="card">
      <div className="header">
        <div>
          <h3 className="patient-name">Scan detail</h3>
          <p className="small">
            Captured: {new Date(scan.capturedAt).toLocaleString()} | Status:{" "}
            {scan.status}
          </p>
          {scan.qualityFlags.length ? (
            <p className="small">Flags: {scan.qualityFlags.join(", ")}</p>
          ) : null}
        </div>
        <Link className="filter-btn" to={`/patients/${patientId}`}>
          Back to patient
        </Link>
      </div>

      <div className="list">
        {scan.images.map((image) => (
          <div key={image.id} className="timeline-item">
            <div>
              <div>Angle: {image.angle}</div>
              <div className="small">
                Blur: {image.blurScore?.toFixed(1) ?? "-"} | Light:{" "}
                {image.lightScore?.toFixed(1) ?? "-"} | Pose:{" "}
                {image.poseOk === null || image.poseOk === undefined
                  ? "-"
                  : image.poseOk
                    ? "ok"
                    : "fail"}
              </div>
              <div className="small">Checksum: {image.checksum ?? "-"}</div>
            </div>
            {image.url ? (
              <a className="filter-btn" href={image.url} target="_blank" rel="noreferrer">
                View image
              </a>
            ) : (
              <span className="badge warn">No image</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
