// Prints the text Vision recognizes in an image (Simplified Chinese + English), one line per block.
// Built by native/build.sh into a universal binary that esbuild embeds in main.js.
import Foundation
import ImageIO
import AppKit
import Vision

guard CommandLine.arguments.count > 1 else { exit(0) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])

func loadImage(_ url: URL) -> CGImage? {
    // ImageIO reads PNG/JPEG/GIF (first frame)/WebP/HEIC without going through NSImage.
    if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
       let image = CGImageSourceCreateImageAtIndex(source, 0, nil) {
        return image
    }
    // SVG and PDF need AppKit to rasterize.
    if let image = NSImage(contentsOf: url) {
        var rect = CGRect(origin: .zero, size: image.size)
        return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }
    return nil
}

guard let cgImage = loadImage(url) else { exit(0) }

let request = VNRecognizeTextRequest { request, _ in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    print(observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
}
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true

try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
