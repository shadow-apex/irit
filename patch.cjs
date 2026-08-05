const fs = require('fs');
let c = fs.readFileSync('electron/main.mjs', 'utf8').replace(/\r\n/g, '\n');

const target = `    } catch (e) {
      // Bỏ qua nếu không có process nào đang chiếm cổng
        ...process.env,
        // Không dùng CI: "1" vì Expo sẽ giới hạn timeout ngrok quá ngắn gây lỗi
        EXPO_NO_TELEMETRY: "1",
      },
    });`;

const replacement = `    } catch (e) {
      // Bỏ qua nếu không có process nào đang chiếm cổng
    }

    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    expoProcess = spawn(npxCmd, ["expo", "start", "--tunnel", "--port", "8081"], {
      cwd: companionPath,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        EXPO_NO_TELEMETRY: "1",
        EXPO_NGROK_AUTHTOKEN: process.env.IRIS_NGROK_AUTHTOKEN,
      },
    });`;

if (c.includes(target)) {
    c = c.replace(target, replacement);
    fs.writeFileSync('electron/main.mjs', c);
    console.log("Replaced successfully!");
} else {
    console.log("Target not found!");
}
