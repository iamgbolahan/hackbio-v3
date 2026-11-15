export type ConnectionStep =
  | {
      step: 1;
      key: "verify_identity";
      label: string;
      status: "verified";
      note: string;
    }
  | {
      step: 2;
      key: "retrieve_baseline";
      label: string;
      status: "verified" | "pending";
    }
  | {
      step: 3;
      key: "connect_bio_monitor";
      label: string;
      status: "connected" | "waiting";
      sessionId: string | null;
      lastReadingAt: string | null;
    }
  | {
      step: 4;
      key: "start_monitoring";
      label: string;
      status: "ready" | "blocked";
    };

export interface ConnectionResponse {
  astronautId: string;
  steps: ConnectionStep[];
}
