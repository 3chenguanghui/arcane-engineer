# 核对版本 · 烬-奥术工程师 试玩版
# ------------------------------------------------------------
# 双击同目录的「核对版本.cmd」即可运行本脚本。
# 功能：算出同目录交付件的字节数与文件 MD5，与下面三个期望值比对，
#       打印「是这一版」或「不是这一版，实际是 …」。
# 改版后只需改本文件里的 $expectSize / $expectMd5 / $expectVer 三处。
# 只依赖 Windows 自带 PowerShell，不需要安装任何东西。

$expectSize = 5026395
$expectMd5  = 'E7139A1C0C4135EC71B8A0DB2468712E'
$expectVer  = 'v2.5.24 / 2026-11-16 23:14'

$target = Join-Path $PSScriptRoot '烬-奥术工程师-试玩版.html'

Write-Host ''
Write-Host '  ============================================================'
Write-Host '    烬 · 奥术工程师 试玩版 · 版本核对'
Write-Host ('    期望版本 : ' + $expectVer)
Write-Host ('    期望字节 : ' + $expectSize)
Write-Host ('    期望 MD5 : ' + $expectMd5)
Write-Host '  ============================================================'
Write-Host ''

if (-not (Test-Path -LiteralPath $target)) {
  Write-Host ('    [X] 没找到文件：' + $target)
  Write-Host '    >>> 核对失败：请把「核对版本.cmd」与「烬-奥术工程师-试玩版.html」放在同一个文件夹。'
  exit 2
}

$item = Get-Item -LiteralPath $target
$md5  = (Get-FileHash -LiteralPath $target -Algorithm MD5).Hash

Write-Host ('    实际字节 : ' + $item.Length)
Write-Host ('    实际 MD5 : ' + $md5)
Write-Host ''

if ($item.Length -eq $expectSize -and $md5 -eq $expectMd5) {
  Write-Host ('    >>> 是这一版（' + $expectVer + '）')
  exit 0
}

Write-Host ('    >>> 不是这一版，实际是 ' + $item.Length + ' 字节 / ' + $md5)
Write-Host ('        （期望 ' + $expectSize + ' 字节 / ' + $expectMd5 + '）')
exit 1
