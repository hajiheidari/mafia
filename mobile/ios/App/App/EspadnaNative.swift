import Foundation
import UIKit
import GameKit
import Capacitor

/// The app's root view controller: the stock Capacitor bridge plus the app's
/// own native plugin (registered here because it lives inside the app, not
/// in an npm package).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EspadnaNativePlugin())
    }
}

/// Game Center (weekly/monthly leaderboards, achievements, the dashboard)
/// and iCloud key-value storage for the web app. The web side calls it
/// through window.Capacitor.nativePromise('EspadnaNative', method, options);
/// see web/tool/native.js.
@objc(EspadnaNativePlugin)
public class EspadnaNativePlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "EspadnaNativePlugin"
    public let jsName = "EspadnaNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "gcAuthenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "gcSubmitPeriodCount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "gcReportAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "gcShowDashboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "kvGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "kvSet", returnType: CAPPluginReturnPromise),
    ]

    private func playerInfo() -> [String: Any] {
        let player = GKLocalPlayer.local
        return ["authenticated": player.isAuthenticated, "name": player.isAuthenticated ? player.displayName : ""]
    }

    // MARK: Game Center

    /// Signs the player in (Apple shows its own sheet the first time).
    @objc func gcAuthenticate(_ call: CAPPluginCall) {
        let player = GKLocalPlayer.local
        if player.isAuthenticated {
            call.resolve(playerInfo())
            return
        }
        var answered = false
        DispatchQueue.main.async {
            player.authenticateHandler = { [weak self] viewController, error in
                if let viewController = viewController {
                    self?.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                if answered { return }
                answered = true
                var info = self?.playerInfo() ?? ["authenticated": false]
                if let error = error { info["error"] = error.localizedDescription }
                call.resolve(info)
            }
        }
    }

    /// Submits how many games were hosted in the leaderboard's current
    /// period (week or month). `timestamps` are the end times (ms) of the
    /// games on this device; only those inside the current occurrence count.
    @objc func gcSubmitPeriodCount(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("not signed in to Game Center")
            return
        }
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("leaderboardId is missing")
            return
        }
        let times: [Double] = (call.getArray("timestamps") ?? []).compactMap { value -> Double? in
            if let number = value as? NSNumber { return number.doubleValue }
            return value as? Double
        }
        GKLeaderboard.loadLeaderboards(IDs: [leaderboardId]) { boards, error in
            guard let board = boards?.first else {
                call.reject(error?.localizedDescription ?? "leaderboard \(leaderboardId) not found")
                return
            }
            var count = times.count
            if let start = board.startDate {
                let from = start.timeIntervalSince1970 * 1000
                let to = from + board.duration * 1000
                count = times.filter { $0 >= from && $0 < to }.count
            }
            board.submitScore(count, context: 0, player: GKLocalPlayer.local) { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["count": count])
                }
            }
        }
    }

    /// Reports achievements: [{ id, percent }]. 100 shows Apple's banner.
    @objc func gcReportAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("not signed in to Game Center")
            return
        }
        let achievements: [GKAchievement] = (call.getArray("achievements") ?? []).compactMap { item -> GKAchievement? in
            guard let entry = item as? JSObject, let id = entry["id"] as? String else { return nil }
            let percent = (entry["percent"] as? NSNumber)?.doubleValue ?? (entry["percent"] as? Double) ?? 100
            let achievement = GKAchievement(identifier: id)
            achievement.percentComplete = min(100, max(0, percent))
            achievement.showsCompletionBanner = true
            return achievement
        }
        if achievements.isEmpty {
            call.resolve()
            return
        }
        GKAchievement.report(achievements) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    /// Opens Apple's Game Center screen on the leaderboards or achievements.
    @objc func gcShowDashboard(_ call: CAPPluginCall) {
        let wantsAchievements = call.getString("view") == "achievements"
        DispatchQueue.main.async {
            let state: GKGameCenterViewControllerState = wantsAchievements ? .achievements : .leaderboards
            let controller = GKGameCenterViewController(state: state)
            controller.gameCenterDelegate = self
            self.bridge?.viewController?.present(controller, animated: true)
            call.resolve()
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }

    // MARK: iCloud key-value storage (the group's roles, scenarios and logo)

    @objc func kvGet(_ call: CAPPluginCall) {
        let store = NSUbiquitousKeyValueStore.default
        store.synchronize()
        let value: Any = store.string(forKey: call.getString("key") ?? "") ?? NSNull()
        call.resolve(["value": value])
    }

    @objc func kvSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("key and value are required")
            return
        }
        let store = NSUbiquitousKeyValueStore.default
        store.set(value, forKey: key)
        store.synchronize()
        call.resolve()
    }
}
