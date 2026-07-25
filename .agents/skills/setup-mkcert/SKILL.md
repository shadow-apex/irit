---
name: Irit Mkcert TLS Setup
description: How to fix the TLS cert/key not found error for the PHONE_CAMERA server when running npm run dev in the irit project.
---

# Fix TLS cert/key not found in Irit project

When a user encounters the error `[FATAL] TLS cert/key not found. iOS Safari needs a TRUSTED https cert.` while starting the development server (`npm run dev`) in the `irit` project, the issue is that local HTTPS certificates for the `PHONE_CAMERA` sub-server are missing.

## Instructions
1. Check if `PHONE_CAMERA\cert\cert.pem` and `PHONE_CAMERA\cert\key.pem` exist.
2. If they are missing, you must generate them using the `mkcert.exe` binary provided in the project root.
3. **Important for Windows Users:** The command `.\mkcert.exe -install` requires Administrator privileges to add the root CA to the Windows trust store. This triggers a User Account Control (UAC) prompt (a shield popup).
4. **DO NOT** attempt to run this command via background tasks (`run_command`), as the agent cannot click "Yes" on the UAC prompt, causing the task to hang indefinitely.
5. Instead, instruct the user to run the following commands manually in their own Terminal within the `irit` directory:

```bash
mkdir PHONE_CAMERA\cert
.\mkcert.exe -install
.\mkcert.exe -key-file PHONE_CAMERA\cert\key.pem -cert-file PHONE_CAMERA\cert\cert.pem localhost 127.0.0.1
```

Once the user confirms they have run these commands and accepted the UAC prompt, they can re-run `npm run dev` successfully.
