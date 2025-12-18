import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

const requiredAngles = ["Front", "Left", "Right", "45° Left", "45° Right"];

const timeline = [
  { date: "Dec 5", angles: 5, status: "Uploaded" },
  { date: "Nov 5", angles: 5, status: "Uploaded" },
  { date: "Oct 12", angles: 4, status: "Processing" }
];

const checks = [
  "Face fully in frame with guidance overlay",
  "Head still within tolerance; green outline = ready",
  "No motion blur detected; hold 1s per angle",
  "Lighting above threshold; avoid backlight"
];

export default function App() {
  const [clinicConnected, setClinicConnected] = useState(false);
  const [captureStep, setCaptureStep] = useState(0);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>SkinSage Clinical</Text>
        <Text style={styles.sub}>Remote skin tracking — patient app</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Connect to clinic</Text>
          <Text style={styles.body}>
            Join with a clinic code or QR. Consent to encrypted image storage.
          </Text>
          <TouchableOpacity
            style={clinicConnected ? styles.btnSecondary : styles.btn}
            onPress={() => setClinicConnected(true)}
          >
            <Text style={clinicConnected ? styles.btnTextDark : styles.btnText}>
              {clinicConnected ? "Connected to Demo Clinic" : "Enter clinic code"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. Guided capture</Text>
          <Text style={styles.body}>Required angles</Text>
          <View style={styles.row}>
            {requiredAngles.map((angle) => (
              <View key={angle} style={styles.pill}>
                <Text style={styles.pillText}>{angle}</Text>
              </View>
            ))}
          </View>
          <View style={styles.list}>
            {checks.map((item) => (
              <View key={item} style={styles.listItem}>
                <View style={styles.bullet} />
                <Text style={styles.body}>{item}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => setCaptureStep((c) => (c + 1) % requiredAngles.length)}
          >
            <Text style={styles.btnText}>
              {`Capture ${requiredAngles[captureStep]} angle`}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>3. Timeline</Text>
          <Text style={styles.body}>Uploads auto-sync after each capture set.</Text>
          {timeline.map((item) => (
            <View key={item.date} style={styles.timelineRow}>
              <View>
                <Text style={styles.timelineDate}>{item.date}</Text>
                <Text style={styles.small}>Angles: {item.angles}/5</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  item.status === "Uploaded" ? styles.statusOk : styles.statusWarn
                ]}
              >
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0b1220"
  },
  container: {
    padding: 20,
    gap: 14
  },
  title: {
    color: "#e2e8f0",
    fontSize: 28,
    fontWeight: "700"
  },
  sub: {
    color: "#94a3b8",
    marginBottom: 8
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8
  },
  cardTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700"
  },
  body: {
    color: "#cbd5e1"
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999
  },
  pillText: {
    color: "#e2e8f0",
    fontWeight: "600"
  },
  list: {
    gap: 6
  },
  listItem: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center"
  },
  bullet: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#2fd2a1"
  },
  btn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2fd2a1"
  },
  btnText: {
    color: "#0b1220",
    textAlign: "center",
    fontWeight: "700"
  },
  btnSecondary: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(47, 210, 161, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(47, 210, 161, 0.5)"
  },
  btnTextDark: {
    color: "#2fd2a1",
    textAlign: "center",
    fontWeight: "700"
  },
  timelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1
  },
  timelineDate: {
    color: "#e2e8f0",
    fontWeight: "700"
  },
  small: {
    color: "#94a3b8"
  },
  statusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8
  },
  statusOk: {
    backgroundColor: "rgba(47, 210, 161, 0.2)"
  },
  statusWarn: {
    backgroundColor: "rgba(255, 179, 64, 0.2)"
  },
  statusText: {
    color: "#0b1220",
    fontWeight: "700"
  }
});
