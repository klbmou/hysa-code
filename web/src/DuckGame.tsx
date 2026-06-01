import React, { useEffect, useRef, useState } from "react";

type Obstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
  counted?: boolean;
};

export default function DuckGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const scoreRef = useRef(0);
  const frameRef = useRef(0);
  const gameOverRef = useRef(false);

  const duckRef = useRef({
    x: 110,
    y: 260,
    width: 46,
    height: 34,
    velocityY: 0,
    gravity: 0.62,
    jumpPower: -12.5,
    jumping: false,
  });

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  function resetGame() {
    const duck = duckRef.current;
    duck.y = 260;
    duck.velocityY = 0;
    duck.jumping = false;

    obstaclesRef.current = [];
    scoreRef.current = 0;
    frameRef.current = 0;
    gameOverRef.current = false;

    setScore(0);
    setGameOver(false);
  }

  function jump() {
    const duck = duckRef.current;

    if (gameOverRef.current) {
      resetGame();
      return;
    }

    if (!duck.jumping) {
      duck.jumping = true;
      duck.velocityY = duck.jumpPower;
    }
  }

  function addObstacle(canvas: HTMLCanvasElement) {
    const height = 34 + Math.random() * 58;

    obstaclesRef.current.push({
      x: canvas.width + 20,
      y: canvas.height - height - 28,
      width: 34,
      height,
    });
  }

  function isColliding(duck: typeof duckRef.current, obstacle: Obstacle) {
    return (
      duck.x - duck.width / 2 < obstacle.x + obstacle.width &&
      duck.x + duck.width / 2 > obstacle.x &&
      duck.y - duck.height / 2 < obstacle.y + obstacle.height &&
      duck.y + duck.height / 2 > obstacle.y
    );
  }

  function drawDuck(ctx: CanvasRenderingContext2D, duck: typeof duckRef.current) {
    ctx.save();

    ctx.fillStyle = "#ffd84d";
    ctx.beginPath();
    ctx.ellipse(duck.x, duck.y, duck.width / 2, duck.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.ellipse(duck.x - 10, duck.y + 2, 11, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(duck.x + 12, duck.y - 8, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(duck.x + 14, duck.y - 10, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.moveTo(duck.x + 22, duck.y - 3);
    ctx.lineTo(duck.x + 36, duck.y);
    ctx.lineTo(duck.x + 22, duck.y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: Obstacle) {
    const gradient = ctx.createLinearGradient(obstacle.x, obstacle.y, obstacle.x, obstacle.y + obstacle.height);
    gradient.addColorStop(0, "#a16207");
    gradient.addColorStop(1, "#713f12");

    ctx.fillStyle = gradient;
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(obstacle.x + 3, obstacle.y + 3, obstacle.width - 6, obstacle.height - 6);
  }

  function drawBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#111827");
    bg.addColorStop(0.55, "#182033");
    bg.addColorStop(1, "#0f172a");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(168, 85, 247, 0.12)";
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(80 + i * 70, 70 + Math.sin((frameRef.current + i * 20) / 40) * 12, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#14532d";
    ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, canvas.height - 28, canvas.width, 4);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      if (!canvas || !ctx) return;

      const duck = duckRef.current;

      if (!gameOverRef.current) {
        frameRef.current += 1;

        duck.velocityY += duck.gravity;
        duck.y += duck.velocityY;

        const groundY = canvas.height - 28 - duck.height / 2;

        if (duck.y >= groundY) {
          duck.y = groundY;
          duck.velocityY = 0;
          duck.jumping = false;
        }

        if (duck.y - duck.height / 2 < 0) {
          duck.y = duck.height / 2;
          duck.velocityY = 0;
        }

        const speed = 5 + Math.floor(scoreRef.current / 5);

        if (frameRef.current % 95 === 0) {
          addObstacle(canvas);
        }

        obstaclesRef.current = obstaclesRef.current
          .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed }))
          .filter((obstacle) => obstacle.x + obstacle.width > -20);

        for (const obstacle of obstaclesRef.current) {
          if (isColliding(duck, obstacle)) {
            gameOverRef.current = true;
            setGameOver(true);
          }

          if (!obstacle.counted && obstacle.x + obstacle.width < duck.x) {
            obstacle.counted = true;
            scoreRef.current += 1;
            setScore(scoreRef.current);
          }
        }
      }

      drawBackground(ctx, canvas);

      for (const obstacle of obstaclesRef.current) {
        drawObstacle(ctx, obstacle);
      }

      drawDuck(ctx, duck);

      if (gameOverRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 42px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2 - 20);

        ctx.font = "22px Arial";
        ctx.fillText("Press Enter or tap Restart", canvas.width / 2, canvas.height / 2 + 28);
      }

      animationRef.current = requestAnimationFrame(loop);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === " " || event.key === "ArrowUp") {
        event.preventDefault();
        jump();
      }

      if (event.key === "Enter" && gameOverRef.current) {
        resetGame();
      }
    }

    function handlePointer(event: Event) {
      event.preventDefault();
      jump();
    }

    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("click", handlePointer);
    canvas.addEventListener("touchstart", handlePointer, { passive: false });

    resetGame();
    animationRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }

      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("click", handlePointer);
      canvas.removeEventListener("touchstart", handlePointer);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "32px",
        color: "#f8fafc",
        background:
          "radial-gradient(circle at top, rgba(168,85,247,0.18), transparent 35%), #070711",
      }}
    >
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "24px",
          background: "rgba(18,18,32,0.78)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div>
            <div style={{ fontSize: "13px", color: "#a78bfa", letterSpacing: "0.08em" }}>
              HYSA MINI GAME
            </div>
            <h1 style={{ margin: "6px 0 0", fontSize: "28px" }}>Duck Game</h1>
          </div>

          <button
            onClick={resetGame}
            style={{
              border: "1px solid rgba(168,85,247,0.45)",
              background: "rgba(168,85,247,0.18)",
              color: "#f8fafc",
              borderRadius: "12px",
              padding: "10px 16px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Restart
          </button>
        </div>

        <div style={{ padding: "18px 24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "12px",
              color: "#cbd5e1",
              fontSize: "14px",
            }}
          >
            <span>Jump: Space / ArrowUp / Tap</span>
            <strong style={{ color: gameOver ? "#fb7185" : "#86efac" }}>Score: {score}</strong>
          </div>

          <canvas
            ref={canvasRef}
            width={800}
            height={420}
            style={{
              width: "100%",
              maxWidth: "100%",
              height: "auto",
              display: "block",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0f172a",
            }}
          />
        </div>
      </div>
    </div>
  );
}
