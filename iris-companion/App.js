import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, Dimensions } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { Audio } from 'expo-av';

export default function App() {
  const [ipAddress, setIpAddress] = useState('192.168.1.10');
  // BUG-COMP-TOKEN FIX: companion-server.mjs luôn yêu cầu query param
  // ?token=... để xác thực (chống ai đó ngoài mạng LAN đoán được cổng
  // 8080 rồi kết nối bừa vào camera/mic). Trước đây app này không có chỗ
  // nào để nhập/gửi token đó, nên MỌI lần kết nối đều bị server từ chối
  // ngay lập tức (đóng WebSocket với code 4001 "Invalid token") — dù các
  // lỗi xử lý frame/audio phía server có được sửa hay không cũng vô ích.
  // Token hiện ra ở màn hình "Iris Camera" (không phải tab "Expo Go") của
  // hộp thoại QR trên máy tính — dán vào ô bên dưới trước khi bấm Connect.
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [statusMsg, setStatusMsg] = useState('STANDBY');
  
  const wsRef = useRef(null);
  const cameraRef = useRef(null);
  const frameIntervalRef = useRef(null);
  // BUG-COMP-01 FIX: Use a ref-based loop flag instead of a stale closure variable.
  const isStreamingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const cameraStatus = await Camera.requestCameraPermissionsAsync();
      const audioStatus = await Audio.requestPermissionsAsync();
      setHasPermission(cameraStatus.status === 'granted' && audioStatus.status === 'granted');
    })();
    return () => {
      disconnect();
    };
  }, []);

  const connect = async () => {
    if (connected) {
      disconnect();
      return;
    }

    try {
      // BUG-COMP-08 FIX: previously this always built `ws://${ipAddress}:8080`,
      // which only ever works when the phone and desktop share the same
      // Wi-Fi/LAN. `expo start --tunnel` only tunnels the Expo/Metro port
      // (8081) that delivers this app's JS bundle — it never tunnels THIS
      // WebSocket (8080, the actual camera/audio stream). So even after
      // installing the app via ngrok, the stream itself still required LAN.
      // Now: if the user pastes a full ws://... or wss://... tunnel URL
      // (shown/copyable in the desktop app's Companion dialog), use it
      // as-is; otherwise treat the input as a bare LAN IP like before.
      const target = ipAddress.trim();
      let wsUrl = /^wss?:\/\//i.test(target) ? target : `ws://${target}:8080`;
      // BUG-COMP-TOKEN FIX: gắn token xác thực vào query string. Nếu
      // `target` đã là một URL tunnel dán sẵn có kèm ?token=... (copy
      // nguyên từ hộp thoại desktop) thì không ghi đè; ngược lại dùng
      // token nhập ở ô riêng.
      const trimmedToken = token.trim();
      if (trimmedToken && !/[?&]token=/i.test(wsUrl)) {
        wsUrl += (wsUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(trimmedToken)}`;
      }
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = async () => {
        setConnected(true);
        setStatusMsg('LIVE STREAMING');
        startStreaming();
      };

      wsRef.current.onclose = () => {
        setConnected(false);
        setStatusMsg('STANDBY');
        stopStreaming();
      };

      wsRef.current.onerror = (e) => {
        console.error('WebSocket Error:', e.message);
        setConnected(false);
        setStatusMsg(`ERROR: ${e.message}`);
        stopStreaming();
      };

      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'error') {
            // BUG-COMP-03 handled: server rejected our connection
            console.warn('Server:', msg.message);
            setStatusMsg(`Rejected: ${msg.message}`);
          }
        } catch {}
      };
    } catch (e) {
      console.error(e);
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setStatusMsg('STANDBY');
    stopStreaming();
  };

  const startStreaming = async () => {
    isStreamingRef.current = true;

    // 1. Start sending Camera frames at 1 FPS
    frameIntervalRef.current = setInterval(async () => {
      if (cameraRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.2,
            base64: true,
            skipProcessing: true,
          });
          wsRef.current.send(JSON.stringify({ type: 'frame', data: photo.base64 }));
        } catch (e) {
          // ignore frame drops
        }
      }
    }, 1000); // 1 FPS

    // 2. BUG-COMP-01 FIX: Stream audio as chunked WAV buffers.
    // We record 500ms segments using LinearPCM (16kHz, 16-bit, mono) and send
    // each segment as a binary WebSocket message.  The desktop companion-server
    // strips the 44-byte WAV header before forwarding raw PCM to Gemini Live.
    streamAudioLoop();
  };

  // Continuously record 500ms PCM chunks and send them over WebSocket.
  const streamAudioLoop = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    while (isStreamingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      let recording = null;
      try {
        const result = await Audio.Recording.createAsync({
          android: {
            extension: '.wav',
            outputFormat: Audio.AndroidOutputFormat.DEFAULT,
            audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 256000,
          },
          ios: {
            extension: '.wav',
            outputFormat: Audio.IOSOutputFormat.LINEARPCM,
            audioQuality: Audio.IOSAudioQuality.MIN,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 256000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {},
          isMeteringEnabled: false,
          keepAudioActiveHint: true,
        });
        recording = result.recording;

        // Record for 500ms per chunk
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!isStreamingRef.current) break;

        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        recording = null;

        if (uri && wsRef.current?.readyState === WebSocket.OPEN) {
          const response = await fetch(uri);
          const arrayBuffer = await response.arrayBuffer();
          // Send as binary — companion-server.mjs will strip the WAV header
          wsRef.current.send(arrayBuffer);
        }
      } catch (e) {
        // On error (e.g. permission revoked), stop trying
        if (recording) {
          try { await recording.stopAndUnloadAsync(); } catch {}
        }
        console.error('Audio chunk error:', e);
        break;
      }
    }
  };

  const stopStreaming = async () => {
    isStreamingRef.current = false;

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    // Audio loop exits naturally when isStreamingRef.current = false
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={styles.text}>Requesting permissions...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={styles.text}>No access to camera or mic</Text></View>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>IRIS COMPANION</Text>
      
      <View style={styles.cameraContainer}>
        {connected ? (
          <Camera style={styles.camera} type={CameraType.front} ref={cameraRef} />
        ) : (
          <View style={[styles.camera, styles.placeholder]}>
            <Text style={styles.text}>Camera Offline</Text>
          </View>
        )}
      </View>

      <View style={styles.controlPanel}>
        <TextInput
          style={styles.input}
          onChangeText={setIpAddress}
          value={ipAddress}
          placeholder="IP LAN (192.168.x.x) hoặc dán URL wss://... từ ngrok"
          placeholderTextColor="#666"
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!connected}
        />

        <TextInput
          style={styles.input}
          onChangeText={setToken}
          value={token}
          placeholder="Token (lấy ở hộp thoại QR trên máy tính, tab Iris Camera)"
          placeholderTextColor="#666"
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!connected}
        />

        <TouchableOpacity 
          style={[styles.button, connected ? styles.buttonDisconnect : styles.buttonConnect]} 
          onPress={connect}
        >
          <Text style={styles.buttonText}>{connected ? "DISCONNECT" : "CONNECT TO IRIS"}</Text>
        </TouchableOpacity>

        <Text style={[styles.status, connected ? styles.statusOn : styles.statusOff]}>
          Status: {statusMsg}
        </Text>

        {connected && (
          <Text style={styles.hint}>
            📷 Camera: 1 FPS  •  🎤 Audio: 16kHz PCM chunks
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#00ffcc',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 40,
    letterSpacing: 2,
  },
  cameraContainer: {
    width: Dimensions.get('window').width * 0.8,
    height: Dimensions.get('window').width * 0.8 * (4/3),
    marginTop: 30,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#333',
  },
  camera: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
  },
  controlPanel: {
    width: '80%',
    marginTop: 30,
    alignItems: 'center',
  },
  input: {
    height: 50,
    width: '100%',
    backgroundColor: '#222',
    color: '#00ffcc',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#444',
  },
  button: {
    width: '100%',
    height: 55,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonConnect: {
    backgroundColor: '#00ffcc',
  },
  buttonDisconnect: {
    backgroundColor: '#ff3366',
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  status: {
    marginTop: 20,
    fontSize: 14,
    fontWeight: '600',
  },
  statusOn: {
    color: '#00ffcc',
  },
  statusOff: {
    color: '#666',
  },
  hint: {
    marginTop: 10,
    color: '#444',
    fontSize: 12,
  },
});
