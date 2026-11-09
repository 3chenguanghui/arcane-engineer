# ============================================================
# 一键快照脚本（双击同目录的“保存快照.cmd”运行）
# 作用：把当前项目状态存成一个 Git 提交，方便以后回到任意一天
# 说明：本脚本只做“读取文件 + 记录历史”，不会删除或回滚任何东西
# ============================================================

# 让中文在 PowerShell 控制台里正常显示
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# 出错时继续执行，由脚本自己决定怎么提示，避免窗口直接崩掉
$ErrorActionPreference = 'Continue'

# 脚本所在目录就是仓库根目录
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
$repoName = Split-Path $repo -Leaf

# 打印一行的简写
function Write-Line([string]$text = '') { Write-Host $text }

Write-Line '============================================'
Write-Line ("项目：" + $repoName)
Write-Line ("路径：" + $repo)
Write-Line ("时间：" + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
Write-Line '--------------------------------------------'

# 0) 确认 Git 已安装
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Line '【停止】这台电脑上找不到 git 命令，请先安装 Git for Windows。'
    exit 1
}

# 1) 确认当前目录确实是 Git 仓库
if (-not (Test-Path (Join-Path $repo '.git'))) {
    Write-Line '【停止】这个文件夹还不是 Git 仓库（找不到 .git 目录）。'
    exit 1
}

# 2) 检查上次操作被强制中断留下的锁文件
$lockFile = Join-Path $repo '.git\index.lock'
if (Test-Path $lockFile) {
    Write-Line '【提示】发现 .git\index.lock，通常是上次 Git 操作被强行中断留下的。'
    Write-Line '       请先确认没有其他 Git 窗口正在运行，然后手动删除这个文件再双击本脚本：'
    Write-Line ('       ' + $lockFile)
    exit 1
}

Push-Location $repo
try {
    # 3) 读取当前分支与上一个快照
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = '(尚无提交)' }
    $beforeHash = (& git rev-parse --short HEAD 2>$null)
    if ([string]::IsNullOrWhiteSpace($beforeHash)) { $beforeHash = '' }
    Write-Line ("当前分支：" + $branch)

    # 4) 把所有改动加入暂存区（相当于“拍下当前所有文件”）
    Write-Line '正在收集改动……'
    $addOutput = (& git add -A 2>&1)
    if ($LASTEXITCODE -ne 0) {
        # 常见原因：某个文件正被编辑器/浏览器/测试脚本独占写入
        Write-Line '【提示】有文件暂时读不到，多半正被其他程序占用；2 秒后自动重试一次……'
        Start-Sleep -Seconds 2
        $addOutput = (& git add -A 2>&1)
        if ($LASTEXITCODE -ne 0) {
            Write-Line '【提示】仍有文件被占用，本次快照没有完成（已保存的内容不受影响）。'
            Write-Line '       请关闭正在写这个项目的程序（编辑器 / 浏览器 / 测试脚本），再双击一次。'
            Write-Line '       下面是 Git 的原始提示，供排查用：'
            $addOutput | ForEach-Object { Write-Line ('       ' + $_) }
            exit 1
        }
        Write-Line '【提示】重试成功，继续保存。'
    }

    # 5) 没有任何变化就不提交，避免产生空快照
    & git diff --cached --quiet 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Line '无变化：文件和上一次快照完全一样，本次不生成新快照。'
        exit 0
    }

    # 6) 统计本次改了多少文件、增删多少行
    $numstat = @(& git diff --cached --numstat 2>$null)
    $fileCount = 0
    $insertions = 0
    $deletions = 0
    foreach ($line in $numstat) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $fileCount++
        $parts = $line -split "`t"
        if ($parts.Length -ge 2) {
            if ($parts[0] -match '^\d+$') { $insertions += [int]$parts[0] }
            if ($parts[1] -match '^\d+$') { $deletions += [int]$parts[1] }
        }
    }

    # 7) 提交信息 = 日期时间 + 变更统计
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $message = '快照 ' + $stamp + ' | ' + $fileCount + ' 个文件，+' + $insertions + ' -' + $deletions

    $commitOutput = (& git commit -m $message 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Write-Line '【提示】提交没有成功，本次快照未保存。Git 说：'
        $commitOutput | ForEach-Object { Write-Line ('       ' + $_) }
        Write-Line '       常见原因：有程序正占用 .git 目录，或磁盘空间不足。'
        exit 1
    }

    # 8) 取这次新快照的短哈希
    $hash = (& git rev-parse --short HEAD 2>$null)

    Write-Line '--------------------------------------------'
    Write-Line '【已保存】本次快照已写入版本历史，随时可以回到这一刻。'
    Write-Line ("仓库路径：" + $repo)
    Write-Line ("当前分支：" + $branch)
    Write-Line ("新快照  ：" + $hash)
    if ($beforeHash) { Write-Line ("上一个  ：" + $beforeHash) }
    Write-Line ("内容摘要：" + $fileCount + " 个文件，+" + $insertions + " -" + $deletions)
    Write-Line ("提交说明：" + $message)
    Write-Line '============================================'

    # 9) 额外确认：提交后工作区应当干净（没有残留未记录的改动）
    $dirty = @(& git status --porcelain 2>$null) | Where-Object { $_ -match '\S' }
    if ($dirty.Count -gt 0) {
        Write-Line '【提示】提交后工作区仍有变化，可能是保存过程中有程序写了新文件。'
        Write-Line '       再双击一次本脚本即可把新增变化也存住。'
    }
}
finally {
    Pop-Location
}
