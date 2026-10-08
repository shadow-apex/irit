import os

file_path = r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\SciFiImageRadar.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
content = content.replace("import React, { useEffect, useState } from 'react';", "import React, { useEffect, useState, useRef } from 'react';\nimport { AUDIO_SRC } from './audio';")

# Add audioRef
content = content.replace("const [fadeComplete, setFadeComplete] = useState(false);", "const [fadeComplete, setFadeComplete] = useState(false);\n  const audioRef = useRef<HTMLAudioElement | null>(null);")

# Add audio play logic inside started effect
old_effect = """  useEffect(() => {
    if (started) {
      const timer = setTimeout(() => {"""
new_effect = """  useEffect(() => {
    if (started) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      const timer = setTimeout(() => {"""
content = content.replace(old_effect, new_effect)

# Add audio element
content = content.replace("<div style={{ color: '#0ff', fontSize: '24px', letterSpacing: '4px', zIndex: 10, animation: 'pulse 1.5s infinite' }}>", "<audio ref={audioRef} src={AUDIO_SRC} preload=\"auto\" />\n        <div style={{ color: '#0ff', fontSize: '24px', letterSpacing: '4px', zIndex: 10, animation: 'pulse 1.5s infinite' }}>")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
