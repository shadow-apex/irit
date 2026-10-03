import json
import sys
import argparse

try:
    import winsdk.windows.ui.notifications.management as n_management
    from winsdk.windows.ui.notifications import KnownNotificationBindings
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Thieu thu vien winsdk. Chay: pip install winsdk"
    }))
    sys.exit(1)

import asyncio

async def get_notifications(limit=5):
    try:
        listener = n_management.UserNotificationListener.current
        access_status = await listener.request_access_async()
        
        # AccessStatus 1 = Allowed
        if access_status != 1:
            print(json.dumps({
                "success": False,
                "error": "Khong co quyen truy cap Notification. Vui long cap quyen trong Windows Settings."
            }))
            sys.exit(1)

        # Get notifications
        # NotificationKinds.TOAST = 1
        notifications = await listener.get_notifications_async(1)
        
        results = []
        count = 0
        for notif in notifications:
            if count >= limit:
                break
                
            app_info = notif.app_info
            app_name = app_info.display_info.display_name if app_info else "Unknown App"
            
            binding = notif.notification.visual.get_binding(KnownNotificationBindings.toast_generic)
            
            texts = []
            if binding:
                text_elements = binding.get_text_elements()
                for t in text_elements:
                    texts.append(t.text)
                    
            results.append({
                "id": notif.id,
                "app": app_name,
                "content": texts,
                "time": str(notif.creation_time)
            })
            count += 1
            
        print(json.dumps({
            "success": True,
            "notifications": results
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    
    asyncio.run(get_notifications(args.limit))


