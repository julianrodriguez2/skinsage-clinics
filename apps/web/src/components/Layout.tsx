import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { loginWithTestOtp } from "../api";

export default function Layout() {
  const queryClient = useQueryClient();
  const [authBusy, setAuthBusy] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("skinsage_token"));

  const handleDemoLogin = async (identifier: string) => {
    setAuthBusy(true);
    try {
      await loginWithTestOtp(identifier);
      setToken(localStorage.getItem("skinsage_token"));
      await queryClient.invalidateQueries();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("skinsage_token");
    localStorage.removeItem("skinsage_refresh");
    setToken(null);
    queryClient.clear();
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="pill">SkinSage Clinical</div>
          <h1 className="title">Clinician Dashboard</h1>
          <p className="subtitle">
            Track scan compliance, review scan quality, and compare progress.
          </p>
          <nav className="nav">
            <Link className="nav-link" to="/">
              Patients
            </Link>
          </nav>
        </div>
        <div className="auth-card">
          <p className="small">Auth</p>
          {token ? (
            <>
              <span className="pill">Signed in</span>
              <button className="filter-btn" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <button
                className="filter-btn"
                onClick={() => handleDemoLogin("demo-clinician@skinsage.com")}
                disabled={authBusy}
              >
                Demo clinician login
              </button>
              <button
                className="filter-btn"
                onClick={() => handleDemoLogin("demo-patient@skinsage.com")}
                disabled={authBusy}
              >
                Demo patient login
              </button>
            </>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}
