import dotenv from 'dotenv';
dotenv.config();

import { triggerSmartHome } from './electron/main/robot-actions.mjs';

async function runTest() {
  console.log("TEST: triggerSmartHome");
  console.log("------------------------");
  console.log("Device: light, Action: toggle");
  
  const result = await triggerSmartHome({ device: "light", action: "toggle" });
  console.log("Result:", result);
  console.log("------------------------");
}

runTest().catch(console.error);
