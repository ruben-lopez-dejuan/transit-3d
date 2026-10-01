function shadeColor(
  hexColor: string,
  percent: number,
) {
  const value = hexColor.replace("#", "");
  const numeric = Number.parseInt(value, 16);
  const amount = Math.round(2.55 * percent);

  const red = Math.max(
    0,
    Math.min(255, (numeric >> 16) + amount),
  );

  const green = Math.max(
    0,
    Math.min(
      255,
      ((numeric >> 8) & 0x00ff) + amount,
    ),
  );

  const blue = Math.max(
    0,
    Math.min(
      255,
      (numeric & 0x0000ff) + amount,
    ),
  );

  return `#${(
    0x1000000 +
    red * 0x10000 +
    green * 0x100 +
    blue
  )
    .toString(16)
    .slice(1)}`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(
    x,
    y,
    width,
    height,
    radius,
  );
}

export function createBusImage(
  color: string,
  shortName: string,
) {
  const canvas = document.createElement("canvas");

  canvas.width = 64;
  canvas.height = 112;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Canvas 2D context is unavailable.",
    );
  }

  // Compact shadow.
  context.fillStyle = "rgba(0,0,0,.32)";
  roundedRect(context, 14, 10, 42, 94, 10);
  context.fill();

  // Shaded body gives a small 3D/model effect.
  const bodyGradient =
    context.createLinearGradient(10, 0, 52, 0);

  bodyGradient.addColorStop(
    0,
    shadeColor(color, -30),
  );

  bodyGradient.addColorStop(
    0.45,
    color,
  );

  bodyGradient.addColorStop(
    1,
    shadeColor(color, 20),
  );

  context.fillStyle = bodyGradient;
  roundedRect(context, 10, 5, 42, 94, 10);
  context.fill();

  context.strokeStyle =
    "rgba(255,255,255,.92)";
  context.lineWidth = 2;
  roundedRect(context, 10, 5, 42, 94, 10);
  context.stroke();

  // Front windscreen. Top of the canvas is the
  // front of the vehicle: bearing 0 = north.
  const glassGradient =
    context.createLinearGradient(0, 12, 0, 30);

  glassGradient.addColorStop(
    0,
    "#e1f6ff",
  );

  glassGradient.addColorStop(
    1,
    "#20485d",
  );

  context.fillStyle = glassGradient;
  roundedRect(context, 15, 11, 32, 17, 6);
  context.fill();

  // Rear window.
  context.fillStyle = "#244757";
  roundedRect(context, 16, 80, 30, 11, 4);
  context.fill();

  // Side windows.
  context.fillStyle = "rgba(18,46,61,.90)";
  roundedRect(context, 13, 35, 5, 36, 2);
  context.fill();
  roundedRect(context, 44, 35, 5, 36, 2);
  context.fill();

  // Roof equipment.
  context.fillStyle = "rgba(255,255,255,.68)";
  roundedRect(context, 23, 39, 16, 26, 4);
  context.fill();

  // Wheels.
  context.fillStyle = "#101518";

  for (const y of [31, 71]) {
    roundedRect(context, 7, y, 5, 13, 2);
    context.fill();

    roundedRect(context, 50, y, 5, 13, 2);
    context.fill();
  }

  // Lights.
  context.fillStyle = "#fff1a6";
  context.fillRect(15, 9, 5, 3);
  context.fillRect(42, 9, 5, 3);

  context.fillStyle = "#ff5050";
  context.fillRect(15, 91, 5, 3);
  context.fillRect(42, 91, 5, 3);

  // Route number.
  context.fillStyle = "rgba(0,0,0,.63)";
  roundedRect(context, 19, 67, 24, 12, 4);
  context.fill();

  context.fillStyle = "#ffffff";
  context.font = "900 9px system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    shortName.slice(0, 6),
    31,
    73,
  );

  return context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
}
