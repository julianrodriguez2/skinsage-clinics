import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, Patient } from "../api";

type Filter = "active" | "needs" | "upcoming";

export default function PatientList() {
  const [filter, setFilter] = useState<Filter>("active");
  const token = localStorage.getItem("skinsage_token");

  const { data, isLoading, error } = useQuery({
    queryKey: ["patients"],
    queryFn: () => apiGet<Patient[]>("/patients"),
    enabled: Boolean(token)
  });

  const filteredPatients = useMemo(() => {
    const patients = data ?? [];
    if (filter === "needs") return patients.filter((p) => p.needsScan);
    if (filter === "upcoming") return [];
    return patients.filter((p) => p.status === "active");
  }, [data, filter]);

  return (
    <>
      <div className="card">
        <div className="filter-row">
          <button
            className={`filter-btn ${filter === "active" ? "active" : ""}`}
            onClick={() => setFilter("active")}
          >
            Active
          </button>
          <button
            className={`filter-btn ${filter === "needs" ? "active" : ""}`}
            onClick={() => setFilter("needs")}
          >
            Needs scan
          </button>
          <button
            className={`filter-btn ${filter === "upcoming" ? "active" : ""}`}
            onClick={() => setFilter("upcoming")}
          >
            Upcoming appointments
          </button>
        </div>

        {!token ? (
          <div className="empty">
            <p className="small">Login required to load patient data.</p>
          </div>
        ) : isLoading ? (
          <div className="empty">
            <p className="small">Loading patients...</p>
          </div>
        ) : error ? (
          <div className="empty">
            <p className="small">Failed to load patients.</p>
          </div>
        ) : filteredPatients.length ? (
          <div className="list">
            {filteredPatients.map((patient) => (
              <div key={patient.id} className="card patient-card">
                <div className="patient-info">
                  <p className="patient-name">{patient.name}</p>
                  <span className="small">
                    Status: {patient.status} {patient.needsScan ? "(needs scan)" : ""}
                  </span>
                </div>
                <div className="pill-stack">
                  {patient.needsScan ? (
                    <span className="badge warn">Needs scan</span>
                  ) : (
                    <span className="badge success">On track</span>
                  )}
                  <Link className="filter-btn" to={`/patients/${patient.id}`}>
                    View profile
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="small">No patients matched this filter.</p>
          </div>
        )}
      </div>
    </>
  );
}
