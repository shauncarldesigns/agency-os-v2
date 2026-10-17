#import <Cocoa/Cocoa.h>
#import <unistd.h>

@interface Launcher : NSObject <NSApplicationDelegate>
@property BOOL starting;
@property NSWindow *window;
@end

@implementation Launcher
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ [self begin]; });
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    for (NSURL *url in urls) {
        if (![url.absoluteString isEqualToString:@"signalhouse://open"] && ![url.absoluteString isEqualToString:@"signalhouse://open/"]) {
            [self fail:@"This launcher only accepts signalhouse://open."]; return;
        }
    }
    [self begin];
}
- (int)run:(NSArray<NSString *> *)arguments {
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/launchctl"];
    task.arguments = arguments;
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) return -1;
    [task waitUntilExit];
    return task.terminationStatus;
}
- (BOOL)ready:(NSURLSession *)session {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL ready = NO;
    NSURL *url = [NSURL URLWithString:@"http://127.0.0.1:3000"];
    NSURLSessionDataTask *task = [session dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (!error && [(NSHTTPURLResponse *)response statusCode] == 200) {
            NSString *html = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            ready = [html containsString:@"Signal House — Content Operations"];
        }
        dispatch_semaphore_signal(done);
    }];
    [task resume];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    return ready;
}
- (void)begin {
    if (self.starting) return;
    self.starting = YES;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 440, 104) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Signalhouse";
    NSTextField *text = [NSTextField labelWithString:@"Starting Signalhouse…\nYour workspace will open when it is ready."];
    text.frame = NSMakeRect(24, 24, 390, 52);
    [self.window.contentView addSubview:text];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.timeoutIntervalForRequest = 3;
        config.timeoutIntervalForResource = 5;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
        BOOL ready = [self ready:session];
        NSString *failure = nil;
        if (!ready) {
            NSString *domain = [NSString stringWithFormat:@"gui/%u", getuid()];
            NSString *service = [domain stringByAppendingString:@"/com.shauncarldesigns.signalhouse.server"];
            NSString *plist = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/LaunchAgents/com.shauncarldesigns.signalhouse.server.plist"];
            if ([self run:@[@"print", service]] != 0 && [self run:@[@"bootstrap", domain, plist]] != 0) {
                failure = @"Could not register the local server. Reinstall the Signalhouse launcher.";
            } else {
                // Never use -k: an already-running server must not be restarted.
                [self run:@[@"kickstart", service]];
                NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:120];
                while (!ready && deadline.timeIntervalSinceNow > 0) {
                    ready = [self ready:session];
                    if (!ready) [NSThread sleepForTimeInterval:1];
                }
                if (!ready) failure = @"Signalhouse did not become ready. Check ~/Library/Logs/Signalhouse/server.log. Another app may be using port 3000.";
            }
        }
        [session invalidateAndCancel];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (failure) { [self fail:failure]; return; }
            if (![NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"http://127.0.0.1:3000"]]) {
                [self fail:@"Could not open your browser. Visit http://127.0.0.1:3000."]; return;
            }
            [NSApp terminate:nil];
        });
    });
}
- (void)fail:(NSString *)message {
    [self.window orderOut:nil];
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Signalhouse could not open";
    alert.informativeText = message;
    alert.alertStyle = NSAlertStyleWarning;
    [NSApp activateIgnoringOtherApps:YES];
    [alert runModal];
    [NSApp terminate:nil];
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        Launcher *delegate = [Launcher new];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [app run];
    }
    return 0;
}
