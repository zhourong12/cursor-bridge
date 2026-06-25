$all = Get-CimInstance Win32_Process
$cursor = $all | Where-Object { $_.Name -eq 'Cursor.exe' }
$allCursor = $all | Where-Object { $_.Name -match 'Cursor|cursor' }
$node = $all | Where-Object { $_.Name -eq 'node.exe' }
$rg = $all | Where-Object { $_.Name -eq 'rg.exe' }
$sandbox = $all | Where-Object { $_.CommandLine -match 'cursorsandbox|CursorSandbox' }
$bridgeNode = $node | Where-Object { $_.CommandLine -match 'cursor-bridge|lark-channel' }

Write-Host "=== SUMMARY ==="
Write-Host "Cursor.exe: $($cursor.Count)"
Write-Host "All Cursor-named: $($allCursor.Count)"
Write-Host "node.exe total: $($node.Count)"
Write-Host "node bridge-related: $($bridgeNode.Count)"
Write-Host "rg.exe: $($rg.Count)"
Write-Host "cursorsandbox-related: $($sandbox.Count)"

Write-Host "`n=== By executable name (cursor-related) ==="
$allCursor | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("{0,-45} {1}" -f $_.Name, $_.Count)
}

Write-Host "`n=== Cursor.exe instances ==="
foreach ($p in $cursor | Sort-Object ParentProcessId, ProcessId) {
  $ppName = ($all | Where-Object ProcessId -eq $p.ParentProcessId).Name
  Write-Host "PID=$($p.ProcessId) PPID=$($p.ParentProcessId) parent=$ppName WS=$([math]::Round($p.WorkingSetSize/1MB,0))MB"
}

Write-Host "`n=== Direct children of Cursor.exe ==="
$cursorPids = @($cursor.ProcessId)
$children = $all | Where-Object { $cursorPids -contains $_.ParentProcessId }
Write-Host "Count: $($children.Count)"
$children | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
}

Write-Host "`n=== Grandchildren sample (children of Cursor children) ==="
$childPids = @($children.ProcessId)
$grand = $all | Where-Object { $childPids -contains $_.ParentProcessId }
Write-Host "Count: $($grand.Count)"
$grand | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  {0,-40} {1}" -f $_.Name, $_.Count)
}

Write-Host "`n=== Bridge node processes ==="
foreach ($p in $bridgeNode) {
  $ppName = ($all | Where-Object ProcessId -eq $p.ParentProcessId).Name
  Write-Host "PID=$($p.ProcessId) PPID=$($p.ParentProcessId) parent=$ppName"
  $cmd = $p.CommandLine
  if ($null -eq $cmd) { $cmd = '(no cmdline)' }
  elseif ($cmd.Length -gt 280) { $cmd = $cmd.Substring(0,280) + '...' }
  Write-Host "  $cmd"
}

Write-Host "`n=== rg.exe parent breakdown ==="
$rg | ForEach-Object {
  $pp = ($all | Where-Object ProcessId -eq $_.ParentProcessId)
  [PSCustomObject]@{ PID=$_.ProcessId; PPID=$_.ParentProcessId; ParentName=$pp.Name }
} | Group-Object ParentName | Sort-Object Count -Descending | ForEach-Object {
  Write-Host ("  parent={0,-30} count={1}" -f $_.Name, $_.Count)
}

Write-Host "`n=== node.exe parent breakdown (top 15) ==="
$node | ForEach-Object {
  $pp = ($all | Where-Object ProcessId -eq $_.ParentProcessId)
  [PSCustomObject]@{ ParentName=$pp.Name }
} | Group-Object ParentName | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object {
  Write-Host ("  parent={0,-30} count={1}" -f $_.Name, $_.Count)
}
