import { useMemo, useState } from "react";

type PatientRow = {
  id: string;
  name: string;
  status: "active" | "inactive";
  needsScan: boolean;
  upcomingAppointment?: string;
  lastScan?: string;
  qualityFlags?: string[];
};

type TimelineItem = {
  id: string;
  date: string;
  angleCount: number;
  status: "complete" | "processing" | "missing";
  qualityFlags?: string[];
};

const patients: PatientRow[] = [
  {
    id: "p-100",
    name: "Jane Doe",
    status: "active",
    needsScan: false,
    lastScan: "2025-12-05",
    qualityFlags: []
  },
  {
    id: "p-101",
    name: "Miguel Alvarez",
    status: "active",
    needsScan: true,
    upcomingAppointment: "2025-12-21",
    lastScan: "2025-10-12",
    qualityFlags: ["missing right45"]
  },
  {
    id: "p-102",
    name: "Priya Nair",
    status: "inactive",
    needsScan: true,
    lastScan: "2025-08-01",
    qualityFlags: ["low lighting"]
  }
];

const timeline: TimelineItem[] = [
  { id: "s-1", date: "2025-12-05", angleCount: 5, status: "complete" },
  { id: "s-2", date: "2025-11-05", angleCount: 5, status: "complete" },
  {
    id: "s-3",
    date: "2025-10-12",
    angleCount: 4,
    status: "processing",
    qualityFlags: ["missing right45"]
  }
];

const requiredAngles = ["Front", "Left", "Right", "45° Left", "45° Right"];

function Badge({
  label,
  tone
}: {
  label: string;
  tone: "success" | "warn";
}) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function PatientCard({ patient }: { patient: PatientRow }) {
  return (
    <div className="card patient-card">
      <div className="patient-info">
        <p className="patient-name">{patient.name}</p>
        <span className="small">
          Last scan: {patient.lastScan ?? "None recorded"}
        </span>
        {patient.qualityFlags?.length ? (
          <span className="small">
            Flags: {patient.qualityFlags.join(", ")}
          </span>
        ) : (
          <span className="small">Quality: good</span>
        )}
      </div>
      <div className="pill-stack">
        {patient.needsScan ? (
          <Badge label="Needs scan" tone="warn" />
        ) : (
          <Badge label="On track" tone="success" />
        )}
        {patient.upcomingAppointment ? (
          <span className="pill">Appt: {patient.upcomingAppointment}</span>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [filter, setFilter] = useState<"active" | "needs" | "upcoming">(
    "active"
  );

  const filteredPatients = useMemo(() => {
    if (filter === "needs") return patients.filter((p) => p.needsScan);
    if (filter === "upcoming")
      return patients.filter((p) => Boolean(p.upcomingAppointment));
    return patients.filter((p) => p.status === "active");
  }, [filter]);

  return (
    <div className="app">
      <div className="header">
        <div>
          <div className="pill">SkinSage Clinical</div>
          <h1 className="title">Clinician Dashboard</h1>
          <p className="subtitle">
            Track scan compliance, launch comparisons, and log treatment notes.
          </p>
        </div>
        <button className="cta">New appointment</button>
      </div>

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
        <div className="list">
          {filteredPatients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} />
          ))}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="header">
            <div>
              <h3 className="patient-name">Scan timeline</h3>
              <p className="small">
                5 required angles: {requiredAngles.join(", ")}
              </p>
            </div>
            <button className="filter-btn">Export</button>
          </div>
          <div className="list">
            {timeline.map((item) => (
              <div key={item.id} className="timeline-item">
                <div>
                  <div>{item.date}</div>
                  <div className="small">
                    Angles captured: {item.angleCount}/5
                  </div>
                  {item.qualityFlags?.length ? (
                    <div className="small">
                      Flags: {item.qualityFlags.join(", ")}
                    </div>
                  ) : null}
                </div>
                {item.status === "complete" ? (
                  <Badge label="Complete" tone="success" />
                ) : (
                  <Badge label="Processing" tone="warn" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="header">
            <div>
              <h3 className="patient-name">Comparison prep</h3>
              <p className="small">Lock alignment and sync zoom across dates.</p>
            </div>
            <button className="filter-btn">Open tool</button>
          </div>
          <div className="grid">
            <div className="pill">
              Selected: 2025-12-05 vs 2025-10-12 (missing right45)
            </div>
            <p className="small">
              Store MediaPipe/ARKit landmarks per angle to enable auto alignment and
              overlay views.
            </p>
            <button className="cta">Generate overlay preview</button>
          </div>
        </div>
      </div>
    </div>
  );
}
