import React, { useState, useRef, useEffect } from "react";
import "./VoxMorph.css";

export default function VoxmorphApp() {
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [originalBlob, setOriginalBlob] = useState(null);
  const [transformedBlob, setTransformedBlob] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("fida");
  const [status, setStatus] = useState("");

  const audioCtxRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
  }, []);

  const voicePresets = {
    fida: { label: "Fida", semitones: 2 },
    bilal: { label: "Bilal", semitones: -3 },
    nesbin: { label: "Nesbin", semitones: 7 },
  };

  const startRecording = async () => {
    setStatus("Requesting microphone...");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("Microphone API not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      setMediaRecorder(mr);
      setChunks([]);

      const localChunks = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) localChunks.push(e.data);
      };

      mr.onstop = () => {
        if (localChunks.length === 0) {
          setStatus("No audio captured.");
          return;
        }
        const blob = new Blob(localChunks, { type: "audio/webm" });
        setOriginalBlob(blob);
        setStatus("Recording complete");
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start();
      setRecording(true);
      setStatus("Recording... (press Stop when done)");
    } catch (err) {
      console.error("Microphone error:", err);
      if (err.name === "NotAllowedError") {
        setStatus("Microphone access denied. Please allow mic permissions in your browser settings.");
      } else if (err.name === "NotFoundError") {
        setStatus("No microphone found on this device.");
      } else {
        setStatus("Microphone access unavailable.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    setRecording(false);
  };

  const handleFileImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".wav")) {
      setStatus("Please select a .wav file");
      return;
    }
  setOriginalBlob(file);
  setStatus(`Loaded file: ${file.name}`);
  };

  const transformVoice = async () => {
    if (!originalBlob) {
      setStatus("No input audio to transform.");
      return;
    }
    setStatus("Loading original audio...");
    const arrayBuffer = await originalBlob.arrayBuffer();
    const audioCtx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    const preset = voicePresets[selectedVoice] || voicePresets.fida;
    const semitones = preset.semitones;
    const rate = Math.pow(2, semitones / 12);

  setStatus(`Applying transform: ${preset.label}`);

    const numChannels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const renderedLength = Math.ceil(decoded.length / rate);
    const offline = new OfflineAudioContext(numChannels, renderedLength, sampleRate);

    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = rate;
    source.connect(offline.destination);
    source.start(0);

    try {
      const renderedBuffer = await offline.startRendering();
      setStatus("Encoding WAV...");
      const wavBlob = bufferToWavBlob(renderedBuffer);
      setTransformedBlob(wavBlob);
      setStatus("Transformation complete");
    } catch (err) {
      console.error(err);
      setStatus("Transformation failed");
    }
  };

  function bufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    let interleaved;
    if (numChannels === 2) {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      interleaved = interleave(left, right);
    } else {
      interleaved = buffer.getChannelData(0);
    }

    const dataLength = interleaved.length * (bitDepth / 8);
    const bufferLen = 44 + dataLength;
    const arrayBuffer = new ArrayBuffer(bufferLen);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    floatTo16BitPCM(view, 44, interleaved);

    return new Blob([view], { type: "audio/wav" });

    function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    function interleave(left, right) {
      const length = left.length + right.length;
      const result = new Float32Array(length);
      let index = 0;
      let inputIndex = 0;
      while (index < length) {
        result[index++] = left[inputIndex];
        result[index++] = right[inputIndex];
        inputIndex++;
      }
      return result;
    }

    function floatTo16BitPCM(output, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        output.setInt16(offset, s, true);
      }
    }
  }

  const downloadTransformed = () => {
    if (!transformedBlob) return;
    const url = URL.createObjectURL(transformedBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
  a.download = `voxmorph_${selectedVoice}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  return (
    <div className="voxmorph-bg">
      <div className="voxmorph-container">
        <div className="voxmorph-title">VoxMorph Voice Transformer</div>
        <div className="voxmorph-desc">Record, import, transform, preview, and download voices with style!</div>
        {status && (
          <div
            className="voxmorph-status"
            style={status.startsWith("Recording") ? { background: '#ff1744', color: '#fff', fontWeight: 700 } : {}}
          >
            {status}
          </div>
        )}
        <div className="voxmorph-controls">
          <button onClick={recording ? stopRecording : startRecording}>
            {recording ? "Stop Recording" : "Start Recording"}
          </button>
          <label className="voxmorph-file-label">
            Choose File
            <input
              type="file"
              accept="audio/wav"
              ref={fileInputRef}
              onChange={handleFileImport}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <div className="voxmorph-voice-select">
          <select
            value={selectedVoice}
            onChange={e => setSelectedVoice(e.target.value)}
            className="voxmorph-dropdown"
          >
            <option value="fida" style={{ color: '#7b2ff2', fontWeight: selectedVoice === 'fida' ? 700 : 500 }}>Fida</option>
            <option value="bilal" style={{ color: '#00c853', fontWeight: selectedVoice === 'bilal' ? 700 : 500 }}>Bilal</option>
            <option value="nesbin" style={{ color: '#f357a8', fontWeight: selectedVoice === 'nesbin' ? 700 : 500 }}>Nesbin</option>
          </select>
        </div>
        <div className="voxmorph-controls">
          <button
            onClick={transformVoice}
            disabled={!originalBlob}
            className="voxmorph-transform-btn"
          >
            <span className="voxmorph-transform-gradient">⚡ Transform</span>
          </button>
        </div>
        <div className="voxmorph-audio">
          <div>
            <strong>Original:</strong>
            <audio controls src={originalBlob ? URL.createObjectURL(originalBlob) : undefined} />
          </div>
          <div>
            <strong>Transformed:</strong>
            <audio controls src={transformedBlob ? URL.createObjectURL(transformedBlob) : undefined} />
          </div>
        </div>
        <div className="voxmorph-download">
          <button onClick={downloadTransformed} disabled={!transformedBlob}>
            Download Transformed Audio
          </button>
        </div>
        <div className="voxmorph-footer">
          Note: This demo applies a simple pitch & speed transform. For high-quality voice conversion connect to a backend model or API.
        </div>
      </div>
    </div>
  );
}