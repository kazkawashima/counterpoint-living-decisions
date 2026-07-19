import { createHash } from "node:crypto";

import { chromium } from "@playwright/test";

import {
  OpenAiManagedRealtimeCallConnector,
  OpenAiManagedRealtimeCallTerminator,
} from "../packages/adapters-openai/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error(
    "OPENAI_API_KEY is required for the media-only Realtime smoke test",
  );
}

const safetyIdentifier = `sha256:${createHash("sha256")
  .update("counterpoint-media-only-realtime-smoke", "utf8")
  .digest("base64url")}`;
const browser = await chromium.launch({ headless: true });
let callId;

try {
  const page = await browser.newPage();
  await page.goto("about:blank");
  const sdpOffer = await page.evaluate(async () => {
    const peer = new globalThis.RTCPeerConnection();
    peer.addTransceiver("audio", { direction: "sendrecv" });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (offer.sdp === undefined) {
      throw new Error("Browser did not create an SDP offer");
    }
    Object.assign(globalThis, { counterpointMediaOnlyPeer: peer });
    return offer.sdp;
  });
  if (!sdpOffer.includes("m=audio ") || sdpOffer.includes("m=application ")) {
    throw new Error("Browser SDP was not media-only");
  }

  const connector = new OpenAiManagedRealtimeCallConnector({ apiKey });
  const call = await connector.connect(
    {
      channel: "private",
      safetyIdentifier,
      sdpOffer,
    },
    (acceptedCallId) => {
      callId = acceptedCallId;
    },
  );
  await page.evaluate(async (sdpAnswer) => {
    const peer = globalThis.counterpointMediaOnlyPeer;
    if (!(peer instanceof globalThis.RTCPeerConnection)) {
      throw new Error("Media-only peer was unavailable");
    }
    await peer.setRemoteDescription({ sdp: sdpAnswer, type: "answer" });
  }, call.sdpAnswer);

  console.log(
    JSON.stringify({
      dataChannelOffered: false,
      model: call.model,
      status: "ok",
    }),
  );
} finally {
  if (callId !== undefined) {
    await new OpenAiManagedRealtimeCallTerminator({ apiKey })
      .hangup(callId)
      .catch(() => undefined);
  }
  await browser.close();
}
