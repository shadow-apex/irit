import sys
import base64
import requests

def test_omniparser(image_path):
    url = "http://127.0.0.1:8000/parse"
    print(f"Gửi ảnh {image_path} tới {url}...")
    
    try:
        with open(image_path, "rb") as f:
            # Gửi file ảnh lên server
            files = {"file": (image_path, f, "image/png")}
            response = requests.post(url, files=files)
            
        if response.status_code != 200:
            print(f"Lỗi kết nối HTTP {response.status_code}: {response.text}")
            return
            
        result = response.json()
        if "error" in result:
            print(f"Server trả về lỗi: {result['error']}")
            return
            
        coordinates = result.get("coordinates", {})
        print(f"✅ Thành công! Phân tích xong, tìm thấy {len(coordinates)} phần tử UI.")
        
        # In ra danh sách tọa độ (in 15 cái đầu)
        for box_id, coords in list(coordinates.items())[:15]:
            print(f"  [{box_id}] Tọa độ ratio (x, y, w, h): {coords}")
            
        if len(coordinates) > 15:
            print(f"  ... và {len(coordinates) - 15} phần tử khác.")
            
        # Lưu ảnh đã đánh dấu
        labeled_b64 = result.get("labeled_image_base64")
        if labeled_b64:
            with open("output_toado.png", "wb") as f:
                f.write(base64.b64decode(labeled_b64))
            print("📸 Đã lưu ảnh được vẽ khung đỏ vào file: output_toado.png")
            
    except Exception as e:
        print(f"❌ Đã xảy ra lỗi: {e}\n(Gợi ý: Kiểm tra xem server api_server.py đã chạy chưa?)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Sử dụng: python test_toado.py <duong_dan_anh>")
    else:
        test_omniparser(sys.argv[1])
