#!/usr/bin/env python3

import requests
import sys

def test_api_endpoints():
    """Test that removed endpoints return 404 and remaining endpoints are accessible"""
    
    base_url = "http://192.168.4.45:8080"
    
    # Test that removed endpoints return 404
    removed_endpoints = [
        # Maintenance endpoints that should be removed
        "/api/v1/maintenance/test_printer/clean-nozzle",
        "/api/v1/maintenance/test_printer/adjust-z-offset", 
        "/api/v1/maintenance/test_printer/print-prime-line",
        "/api/v1/maintenance/test_printer/calibrate-pressure-advance",
        "/api/v1/maintenance/test_printer/purge-line",
        
        # Camera endpoints that should be removed
        "/api/v1/camera/test_printer/stream-info",
        "/api/v1/camera/test_printer/start-recording",
        "/api/v1/camera/test_printer/stop-recording", 
        "/api/v1/camera/test_printer/recording-status",
        "/api/v1/camera/test_printer/timelapse-status",
        
        # System endpoints that should be removed
        "/api/v1/system/test_printer/emergency-stop",
        "/api/v1/system/test_printer/fan-speeds",
        "/api/v1/system/test_printer/set-part-cooling-fan",
        "/api/v1/system/test_printer/set-print-speed",
        "/api/v1/system/test_printer/shutdown",
        "/api/v1/system/test_printer/set-auxiliary-fan",
        "/api/v1/system/test_printer/set-chamber-fan",
        "/api/v1/system/test_printer/set-fan-speed-multiplier"
    ]
    
    # Test endpoints that should still exist
    existing_endpoints = [
        "/api/v1/camera/test_printer/snapshot",  # Should still exist
        "/api/v1/system/test_printer/gcode",     # Should still exist  
        "/api/v1/system/test_printer/reset",     # Should still exist
        "/api/v1/system/test_printer/system/info", # Should still exist
        "/api/v1/system/test_printer/reboot"     # Should still exist
    ]
    
    print("Testing Second Cleanup Phase Results")
    print("=" * 50)
    
    # Check removed endpoints return 404
    print(f"\nTesting {len(removed_endpoints)} removed endpoints...")
    removed_count = 0
    for endpoint in removed_endpoints:
        try:
            response = requests.get(f"{base_url}{endpoint}", timeout=5)
            if response.status_code == 404:
                removed_count += 1
                print(f"PASS: {endpoint} -> 404 (correctly removed)")
            else:
                print(f"FAIL: {endpoint} -> {response.status_code} (should be 404)")
        except Exception as e:
            print(f"ERROR: {endpoint} -> {str(e)}")
    
    # Check existing endpoints are accessible (not 404)
    print(f"\nTesting {len(existing_endpoints)} remaining endpoints...")
    existing_count = 0
    for endpoint in existing_endpoints:
        try:
            response = requests.get(f"{base_url}{endpoint}", timeout=5)
            if response.status_code != 404:
                existing_count += 1
                print(f"PASS: {endpoint} -> {response.status_code} (still exists)")
            else:
                print(f"FAIL: {endpoint} -> 404 (should still exist)")
        except Exception as e:
            print(f"ERROR: {endpoint} -> {str(e)}")
    
    # Summary
    print(f"\n" + "=" * 50)
    print(f"SUMMARY:")
    print(f"Removed endpoints: {removed_count}/{len(removed_endpoints)} correctly return 404")
    print(f"Existing endpoints: {existing_count}/{len(existing_endpoints)} still accessible")
    
    if removed_count == len(removed_endpoints) and existing_count == len(existing_endpoints):
        print("SUCCESS: Second cleanup phase verification completed successfully!")
        return True
    else:
        print("WARNING: Some endpoints may not be in expected state")
        return False

if __name__ == "__main__":
    success = test_api_endpoints()
    sys.exit(0 if success else 1)