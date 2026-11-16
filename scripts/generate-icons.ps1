# Rebuild the browser and installed-app icons from public/icons/favicon.svg.
# Uses Windows System.Drawing; no additional dependencies are required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public\icons'))
[xml]$source = Get-Content -LiteralPath (Join-Path $iconDirectory 'favicon.svg') -Raw
$rectangles = $source.SelectNodes('//*[local-name()="rect"]')

function New-IconPng {
    param([int]$Size, [bool]$Rounded)
    $supersampling = 4
    $canvas = [System.Drawing.Bitmap]::new($Size * $supersampling, $Size * $supersampling)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($Size * $supersampling / 32.0), ($Size * $supersampling / 32.0))
    try {
        foreach ($rectangle in $rectangles) {
            $x = if ($rectangle.HasAttribute('x')) { [single]$rectangle.GetAttribute('x') } else { 0 }
            $y = if ($rectangle.HasAttribute('y')) { [single]$rectangle.GetAttribute('y') } else { 0 }
            $width = [single]$rectangle.GetAttribute('width')
            $height = [single]$rectangle.GetAttribute('height')
            $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($rectangle.GetAttribute('fill')))
            try {
                if ($Rounded -and $rectangle.HasAttribute('rx')) {
                    $diameter = [single]$rectangle.GetAttribute('rx') * 2
                    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
                    try {
                        $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
                        $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
                        $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
                        $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
                        $path.CloseFigure()
                        $graphics.FillPath($brush, $path)
                    } finally { $path.Dispose() }
                } else {
                    $graphics.FillRectangle($brush, $x, $y, $width, $height)
                }
            } finally { $brush.Dispose() }
        }
        $output = [System.Drawing.Bitmap]::new($Size, $Size)
        $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
        $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
        $stream = [System.IO.MemoryStream]::new()
        try {
            $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $outputGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $outputGraphics.DrawImage($canvas, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size), 0, 0, $canvas.Width, $canvas.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
            $output.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return ,$stream.ToArray()
        } finally {
            $stream.Dispose()
            $attributes.Dispose()
            $outputGraphics.Dispose()
            $output.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $canvas.Dispose()
    }
}

foreach ($size in @(16, 32)) {
    [System.IO.File]::WriteAllBytes((Join-Path $iconDirectory "favicon-$size.png"), (New-IconPng -Size $size -Rounded $true))
}
foreach ($size in @(192, 512)) {
    [System.IO.File]::WriteAllBytes((Join-Path $iconDirectory "icon-$size.png"), (New-IconPng -Size $size -Rounded $false))
}
# iOS applies its own corner mask, so installed-app PNGs keep opaque square backgrounds.
[System.IO.File]::WriteAllBytes((Join-Path $iconDirectory 'apple-touch-icon.png'), (New-IconPng -Size 180 -Rounded $false))

# ICO supports embedded PNG images. Include native 16, 32 and 48 pixel entries.
$sizes = @(16, 32, 48)
$images = @($sizes | ForEach-Object { ,(New-IconPng -Size $_ -Rounded $true) })
$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        $writer.Write([byte]$sizes[$index])
        $writer.Write([byte]$sizes[$index])
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$index].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$index].Length
    }
    foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes((Join-Path $iconDirectory 'favicon.ico'), $icoStream.ToArray())
} finally {
    $writer.Dispose()
    $icoStream.Dispose()
}
Write-Output 'Generated SVG-based favicons, ICO, PWA icons and Apple touch icon.'
