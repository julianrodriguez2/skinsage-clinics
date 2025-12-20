import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet, Patient, Scan } from "../api";

export default function PatientProfile() {
  const { id } = useParams();
  const patientId = id ?? "";

  const patientQuery = useQuery({
    queryKey: ["patient", patientId],
    queryFn: () => apiGet<Patient>(`/patients/${patientId}`),
    enabled: Boolean(patientId)
  });

  const scansQuery = useQuery({
    queryKey: ["scans", patientId],
    queryFn: () => apiGet<Scan[]>(`/patients/${patientId}/scans`),
    enabled: Boolean(patientId)
  });

  if (!patientId) {
    return (
      <div className="card">
        <p className="small">Missing patient ID.</p>
      </div>
    );
  }

  if (patientQuery.isLoading) {
    return (
      <div className="card">
        <p className="small">Loading patient...</p>
      </div>
    );
  }

  if (patientQuery.error || !patientQuery.data) {
    return (
      <div className="card">
        <p className="small">Patient not found.</p>
      </div>
    );
  }

  const patient = patientQuery.data;

  return (
    <div className="grid two">
      <div className="card">
        <div className="header">
          <div>
            <h2 className="patient-name">{patient.name}</h2>
            <p className="small">Status: {patient.status}</p>
            <p className="small">Clinic: {patient.clinicId}</p>
            <p className="small">Consent: {patient.consentVersion}</p>
          </div>
          <Link className="filter-btn" to="/">
            Back to list
          </Link>
        </div>
        <div className="list">
          <div className="timeline-item">
            <div>
              <div className="small">Email</div>
              <div>{patient.email ?? "Not provided"}</div>
            </div>
            <div>
              <div className="small">Phone</div>
              <div>{patient.phone ?? "Not provided"}</div>
            </div>
          </div>
          <div className="timeline-item">
            <div>
              <div className="small">Created</div>
              <div>{new Date(patient.createdAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="small">Joined</div>
              <div>{patient.joinedAt ? new Date(patient.joinedAt).toLocaleString() : "-"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="header">
          <div>
            <h3 className="patient-name">Scan timeline</h3>
            <p className="small">Track quality flags and missing angles.</p>
          </div>
        </div>
        {scansQuery.isLoading ? (
          <p className="small">Loading scans...</p>
        ) : scansQuery.error ? (
          <p className="small">Failed to load scans.</p>
        ) : scansQuery.data && scansQuery.data.length ? (
          <div className="list">
            {scansQuery.data.map((scan) => (
              <div key={scan.id} className="timeline-item">
                <div>
                  <div>{new Date(scan.capturedAt).toLocaleDateString()}</div>
                  <div className="small">
                    Status: {scan.status} | Missing: {scan.missingAngles.length}
                  </div>
                  {scan.qualityFlags.length ? (
                    <div className="small">Flags: {scan.qualityFlags.join(", ")}</div>
                  ) : null}
                </div>
                <Link className="filter-btn" to={`/patients/${patientId}/scans/${scan.id}`}>
                  View scan
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="small">No scans yet.</p>
        )}
      </div>
    </div>
  );
}
