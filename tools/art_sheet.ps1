# ============================================================
# 人物设计对照拼图：把同机位 A/B 与三种姿态裁切拼成一张图
# ------------------------------------------------------------
# 用法： powershell -ExecutionPolicy Bypass -File tools\art_sheet.ps1
# 产出： .screenshots\art\pass-compare.png
# ============================================================
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$art  = Join-Path $root '.screenshots\art'

# ---- 布局参数 ----
$cellW = 360          # 每个小格宽（像素）
$cellH = 380          # 每个小格高（含标题条）
$pad   = 12           # 格间距
$titleH = 34          # 标题条高度
$cols  = 4
$rows  = 2
$outW  = $pad + $cols * ($cellW + $pad)
$outH  = $pad + $rows * ($cellH + $pad)

$bmp = New-Object System.Drawing.Bitmap($outW, $outH)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.Clear([System.Drawing.Color]::FromArgb(255, 18, 20, 26))

$font     = New-Object System.Drawing.Font('Microsoft YaHei', 13, [System.Drawing.FontStyle]::Bold)
$fontSm   = New-Object System.Drawing.Font('Microsoft YaHei', 10, [System.Drawing.FontStyle]::Regular)
$titleBr  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 240, 255))
$subBr    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 130, 160, 190))
$linePen  = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 46, 56, 72), 1)

# 定义每一格：文件名 + 主标题 + 副标题
$cells = @(
  @{ f = 'pass-before.png'; t = '旧版 · 设计前'; s = '同机位 A/B' },
  @{ f = 'pass-after.png';  t = '设计版 · 主副配色'; s = '同机位 A/B' },
  @{ f = 'pass-run.png';    t = '跑动 · 前倾'; s = '姿态关键帧' },
  @{ f = 'pass-attack.png'; t = '攻击 · 前压'; s = '姿态关键帧' },
  @{ f = 'pass-hit.png';    t = '受击 · 后坐'; s = '姿态关键帧' },
  @{ f = 'pass-blink-start.png'; t = '瞬移 · 起手残影'; s = '蓄力 0.16s / 3 影' },
  @{ f = 'pass-blink-land.png';  t = '瞬移 · 落地残影'; s = '顿帧 0.10s / 3 影' }
)

$i = 0
foreach ($c in $cells) {
  $col = $i % $cols
  $row = [math]::Floor($i / $cols)
  $x = $pad + $col * ($cellW + $pad)
  $y = $pad + $row * ($cellH + $pad)

  # 标题
  $g.DrawString($c.t, $font, $titleBr, ($x + 6), ($y + 2))
  $g.DrawString($c.s, $fontSm, $subBr, ($x + 6), ($y + 20))
  $g.DrawLine($linePen, $x, ($y + $titleH - 2), ($x + $cellW), ($y + $titleH - 2))

  # 图片缩放绘制（保持比例，居中）
  $p = Join-Path $art $c.f
  if (Test-Path $p) {
    $img = [System.Drawing.Image]::FromFile($p)
    $boxW = $cellW
    $boxH = $cellH - $titleH - 6
    $scale = [math]::Min($boxW / $img.Width, $boxH / $img.Height)
    $dw = [int]($img.Width * $scale)
    $dh = [int]($img.Height * $scale)
    $dx = $x + [int](($boxW - $dw) / 2)
    $dy = $y + $titleH + [int](($boxH - $dh) / 2)
    $g.DrawImage($img, $dx, $dy, $dw, $dh)
    $img.Dispose()
  }
  $i++
}

$outPath = Join-Path $art 'pass-compare.png'
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("WROTE " + $outPath)
