$all = Get-CimInstance Win32_Process

function Get-Descendants($rootPid, $allProcs) {
  $result = @()
  $queue = @($rootPid)
  $seen = @{}
  while ($queue.Count -gt 0) {
    $pid = $queue[0]
    $queue = $queue[1..($queue.Count-1)]
    if ($seen[$pid]) { continue }
    $seen[$pid] = $true
    $kids = $allProcs | Where-Object { $_.ParentProcessId -eq $pid }
    foreach ($k in $kids) {
      $result += $k
      $queue += $k.ProcessId
    }
  }
  return $result
}

$roots = $all | Where-Object { $_.Name -eq 'Cursor.exe' -and $_.ParentProcessId -eq (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue).ProcessId }
# Find main Cursor root (parent = explorer.exe)
$mainCursor = $all | Where-Object { $_.Name -eq 'Cursor.exe' -and ($all | Where-Object ProcessId -eq $_.ParentProcessId).Name -eq 'explorer.exe' }
Write-Host "Main Cursor root PID(s): $($mainCursor.ProcessId -join ', ')"

foreach ($root in $mainCursor) {
  $desc = Get-Descendants $root.ProcessId $all
  Write-Host "`n=== Full tree under main Cursor PID=$($root.ProcessId) ==="
  Write-Host "Total descendants: $($desc.Count)"
  $desc | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
  }
}

# All processes related to cursor workspace
Write-Host "`n=== ALL processes with cursor in commandline ==="
$cmdMatch = $all | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'cursor|Cursor|\.cursor') }
Write-Host "Count: $($cmdMatch.Count)"
$cmdMatch | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
}

# conhost, powershell under cursor tree
Write-Host "`n=== conhost/powershell/java under cursor tree ==="
if ($mainCursor) {
  $desc = Get-Descendants $mainCursor[0].ProcessId $all
  $desc | Where-Object { $_.Name -match 'conhost|powershell|java|cmd|jcmd|esbuild|git' } | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
    Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
  }
}

# Total unique PIDs in cursor ecosystem
$cursorPids = ($all | Where-Object { $_.Name -match 'Cursor\.exe' }).ProcessId
$ecosystem = $all | Where-Object {
  $_.Name -match 'Cursor\.exe' -or
  ($_.CommandLine -and $_.CommandLine -match 'cursor-bridge|lark-channel|\.cursor|Cursor') -or
  ($cursorPids -contains $_.ParentProcessId)
}
Write-Host "`n=== Broad Cursor ecosystem (cursor.exe + direct parent-child + cmdline match) ==="
Write-Host "Unique count: $($ecosystem.Count)"

# wmic tasklist style total for user
$totalRelated = @()
foreach ($root in $mainCursor) {
  $totalRelated += $root
  $totalRelated += Get-Descendants $root.ProcessId $all
}
$totalRelated = $totalRelated | Sort-Object ProcessId -Unique
Write-Host "`n=== Main Cursor + all descendants (unique) ==="
Write-Host "Total: $($totalRelated.Count)"
$totalRelated | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
}

# List node under cursor with cmdlines
Write-Host "`n=== node.exe under Cursor tree (with cmdline) ==="
if ($mainCursor) {
  $desc = Get-Descendants $mainCursor[0].ProcessId $all
  $desc | Where-Object Name -eq 'node.exe' | ForEach-Object {
    $cmd = $_.CommandLine
    if ($null -eq $cmd) { $cmd = '(null)' }
    elseif ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0,200) + '...' }
    Write-Host "PID=$($_.ProcessId) PPID=$($_.ParentProcessId) $cmd"
  }
}
