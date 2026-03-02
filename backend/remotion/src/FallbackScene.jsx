// Auto-generated fallback scene - used when AI-generated code fails to compile.
// Shows the section text on a dark background with simple fade animation.
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig } from 'remotion';

export const Scene = ({ text = '' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '100px',
      }}
    >
      <div
        style={{
          opacity,
          color: '#ffffff',
          fontSize: '56px',
          fontWeight: '600',
          textAlign: 'center',
          lineHeight: 1.5,
          maxWidth: '1500px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textShadow: '0 2px 20px rgba(99,102,241,0.4)',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export default Scene;
