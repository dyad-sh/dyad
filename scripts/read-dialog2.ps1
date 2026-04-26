Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$targetPid = (Get-Process JoyCreate -EA 0 | Select-Object -First 1).Id
"PID: $targetPid"
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
"Top-level windows: $($elements.Count)"
foreach ($el in $elements) {
  Write-Host "=== Window: '$($el.Current.Name)' cls=$($el.Current.ClassName) ==="
  $children = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($c in $children) {
    $name = $c.Current.Name
    $cls = $c.Current.ClassName
    $ctype = $c.Current.ControlType.LocalizedControlType
    if ($name) {
      Write-Host "  [$ctype] cls=$cls name=`"$name`""
    }
  }
}
