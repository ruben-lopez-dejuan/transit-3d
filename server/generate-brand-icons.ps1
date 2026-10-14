# Render the code-native icon.svg geometry into installation PNGs, without font dependencies.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskPublic = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public'))
foreach ($taskSize in @(192, 512)) {
  $taskBitmap = [Drawing.Bitmap]::new($taskSize, $taskSize)
  $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
  $taskBackground = [Drawing.Drawing2D.GraphicsPath]::new()
  $taskLetter = [Drawing.Drawing2D.GraphicsPath]::new()
  $taskGreen = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#246b57'))
  $taskWhite = [Drawing.SolidBrush]::new([Drawing.Color]::White)
  try {
    $taskGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskGraphics.ScaleTransform([single]($taskSize / 192), [single]($taskSize / 192))
    $taskBackground.AddArc(0, 0, 88, 88, 180, 90)
    $taskBackground.AddArc(104, 0, 88, 88, 270, 90)
    $taskBackground.AddArc(104, 104, 88, 88, 0, 90)
    $taskBackground.AddArc(0, 104, 88, 88, 90, 90)
    $taskBackground.CloseFigure()
    $taskGraphics.FillPath($taskGreen, $taskBackground)
    $taskLetter.AddLines([Drawing.PointF[]]@(
      [Drawing.PointF]::new(78,45), [Drawing.PointF]::new(103,45),
      [Drawing.PointF]::new(103,78), [Drawing.PointF]::new(130,78),
      [Drawing.PointF]::new(130,101), [Drawing.PointF]::new(103,101),
      [Drawing.PointF]::new(103,127)))
    $taskLetter.AddBezier(103,127, 103,139, 107,144, 120,144)
    $taskLetter.AddLines([Drawing.PointF[]]@(
      [Drawing.PointF]::new(120,144), [Drawing.PointF]::new(132,144),
      [Drawing.PointF]::new(132,166), [Drawing.PointF]::new(116,166)))
    $taskLetter.AddBezier(116,166, 90,166, 78,154, 78,130)
    $taskLetter.AddLines([Drawing.PointF[]]@(
      [Drawing.PointF]::new(78,130), [Drawing.PointF]::new(78,101),
      [Drawing.PointF]::new(60,101), [Drawing.PointF]::new(60,78),
      [Drawing.PointF]::new(78,78), [Drawing.PointF]::new(78,45)))
    $taskLetter.CloseFigure()
    $taskGraphics.FillPath($taskWhite, $taskLetter)
    $taskBitmap.Save((Join-Path $taskPublic "icon-$taskSize.png"), [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $taskGreen.Dispose(); $taskWhite.Dispose(); $taskLetter.Dispose()
    $taskBackground.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
  }
}
