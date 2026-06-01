#include <Arduino_JSON.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <Adafruit_SSD1306.h>
#include <FluxGarage_RoboEyes.h>

const char* serverURL = "http://10.17.180.145:5000/api/water";
const char* ssid = "IoT kelompok8";
const char* password = "satusampaidelapanbelas";

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
RoboEyes<Adafruit_SSD1306> roboEyes(display);

// Tank dimensions
const float minDistance = 2.0;  // Min distance (sensor to full water level) in cm
const float maxDistance = 15.0; // Max distance (sensor to empty level) in cm

float jarakSmooth = 0;
#define KECEPATAN_SUARA 0.0343
#define TRIG_PIN 18
#define ECHO_PIN 19
#define relay 26
#define merah 15
#define kuning 4
#define hijau 5

void kirimKeServer(int waterLevel) 
{
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(serverURL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"water_level\":" + String(waterLevel) + "}";
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.print("Server response: ");
    Serial.println(httpCode);
  } else {
    Serial.println("Gagal kirim data");
  }
  http.end();
}

float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

int wifiArcStep = 0;
unsigned long lastWifiAnim = 0;
int dotCount = 0;
int dotTimer = 0;

void drawWifiConnecting() {
  unsigned long now = millis();
  if (now - lastWifiAnim > 300) {
    lastWifiAnim = now;
    wifiArcStep = (wifiArcStep + 1) % 5;
    dotCount = (dotCount + 1) % 4;
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  int cx = 64, cy = 32;

  // Titik tengah bawah
 display.fillCircle(cx, cy, 3, WHITE);

  // Arc kecil
  if (wifiArcStep >= 1) {
    for (int a = 210; a <= 330; a++) {
      float r = a * PI / 180.0;
      display.drawPixel(cx + cos(r)*9,  cy + sin(r)*9,  WHITE);
      display.drawPixel(cx + cos(r)*10, cy + sin(r)*10, WHITE);
    }
  }

  // Arc sedang
  if (wifiArcStep >= 2) {
    for (int a = 210; a <= 330; a++) {
      float r = a * PI / 180.0;
      display.drawPixel(cx + cos(r)*16, cy + sin(r)*16, WHITE);
      display.drawPixel(cx + cos(r)*17, cy + sin(r)*17, WHITE);
    }
  }

  // Arc besar
  if (wifiArcStep >= 3) {
    for (int a = 210; a <= 330; a++) {
      float r = a * PI / 180.0;
      display.drawPixel(cx + cos(r)*23, cy + sin(r)*23, WHITE);
      display.drawPixel(cx + cos(r)*24, cy + sin(r)*24, WHITE);
    }
  }

  display.display();
}

// Function to display water level on OLED
void displayWaterLevel(int level) 
{
    display.clearDisplay();

    display.setCursor(20, 5);
    display.setTextSize(1);
    display.print("Water");

    display.setCursor(20, 15);
    display.print("Level");

    display.setCursor(0, 30);
    display.setTextSize(3);
    display.print(level);
    display.print("%");

    int tankX = 72;
    int tankY = 5;
    int tankWidth = 55;
    int tankHeight = 50;

    display.drawRoundRect(tankX, tankY, tankWidth, tankHeight, 5, WHITE);

    display.drawLine(tankX + 5, tankY - 3, tankX + tankWidth - 5, tankY - 3, WHITE);
    display.drawLine(tankX + 5, tankY - 3, tankX, tankY, WHITE);
    display.drawLine(tankX + tankWidth - 5, tankY - 3, tankX + tankWidth, tankY, WHITE);

    display.drawLine(tankX + 8, tankY - 6, tankX + 8, tankY - 12, WHITE);
    display.drawLine(tankX + 8, tankY - 12, tankX + 14, tankY - 12, WHITE);
    display.drawLine(tankX + 14, tankY - 12, tankX + 14, tankY - 6, WHITE);

    int waterHeight = map(level, 0, 100, 0, tankHeight);
    display.fillRoundRect(tankX + 2, tankY + tankHeight - waterHeight, tankWidth - 4, waterHeight, 5, WHITE);

    display.display();
}

float bacaUltrasonic()
{
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  //Baca durasi echo 
  unsigned long durasi = pulseIn(ECHO_PIN, HIGH, 30000);

  //Jika timeout (tidak ada echo), kembalikan -1
  if (durasi == 0) {
    return -1.0;
  }

  // Hitung jarak
  float jarak = (durasi * KECEPATAN_SUARA) / 2.0;
  return jarak;
}

void setup()
{
  Serial.begin(115200);
  Wire.begin(21, 22);  //SDA, SCL
  
  pinMode(merah, OUTPUT);
  pinMode(kuning, OUTPUT);
  pinMode(hijau, OUTPUT);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(relay, OUTPUT);

  digitalWrite(hijau, LOW);
  digitalWrite(merah, LOW);
  digitalWrite(kuning, LOW);

  // OLED startup
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C))
  {
    Serial.println(F("SSD1306 allocation failed"));
    while(true);
  }

  // RoboEyes startup
  roboEyes.begin(SCREEN_WIDTH, SCREEN_HEIGHT, 100);
  roboEyes.setAutoblinker(ON, 3, 2);
  roboEyes.setIdleMode(ON, 2, 2);

  WiFi.begin(ssid, password);

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(34, 20);
  display.println("Kelompok 8");

  display.setCursor(0, 35);
  display.println("MONITORING TANGKI AIR");
  display.display();
  delay(2000);

  while(WiFi.status() != WL_CONNECTED)
  {
    unsigned long start = millis();

    while(millis() - start < 5000 && WiFi.status() != WL_CONNECTED)
    {
      roboEyes.update();
      delay(20);
    }

    if(WiFi.status() == WL_CONNECTED) break;

    start = millis();
    while(millis() - start < 4000 && WiFi.status() != WL_CONNECTED)
    {
      drawWifiConnecting();
      delay(50);
    }
}

  // RESET I2C DEVICE STATE
  Wire.end();
  delay(50);
  Wire.begin(21, 22);
  Wire.setClock(100000);

  //wifi connected debug
  roboEyes.setAutoblinker(OFF);
  roboEyes.setIdleMode(OFF);
  roboEyes.setPosition(DEFAULT);

  roboEyes.setMood(HAPPY);  
  unsigned long happyStart = millis();

  while(millis() - happyStart < 1000)
  {
    roboEyes.update();
    delay(20);
   }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(10,20);
  display.println("WiFi Connected!");
  display.setCursor(10,40);
  display.println(WiFi.localIP());
  display.display();
  delay(1500);
  display.clearDisplay();

  //debug serial monitor
  // Serial.println("WiFi Connected!");
  // Serial.println(WiFi.localIP());
}

void loop()
{
  float jarak = bacaUltrasonic();
   if (jarak < 0) return;

  //debug ultrasonic
  // Serial.print("Jarak: ");
  // Serial.print(jarak);
  // Serial.println(" cm");
  // delay(500);

  float alpha = 0.2;
  jarakSmooth = (alpha * jarak) + ((1 - alpha) * jarakSmooth);

  int waterLevel = (int)mapFloat(jarakSmooth, minDistance, maxDistance, 100.0, 0.0);
  waterLevel = constrain(waterLevel, 0, 100);

  displayWaterLevel(waterLevel);
  kirimKeServer(waterLevel);

  //debug tangki air
  // Serial.print("Water Level: ");
  // Serial.print(waterLevel);
  // Serial.println("%");

  if (waterLevel > 70 && waterLevel <= 100) //tangki cukup
  {
    digitalWrite(hijau, HIGH);
    digitalWrite(merah, LOW);
    digitalWrite(kuning, LOW);

    digitalWrite(relay, LOW); 
  }
  else if (waterLevel >= 30 && waterLevel < 70) //tangki sedang
  {
    digitalWrite(hijau, LOW);
    digitalWrite(merah, LOW);
    digitalWrite(kuning, HIGH);

    digitalWrite(relay, LOW); 
  }
  else if (waterLevel >= 0 && waterLevel <=30) //tangki kritis
  {
    digitalWrite(hijau, LOW);
    digitalWrite(merah, HIGH);
    digitalWrite(kuning, LOW);

    digitalWrite(relay, HIGH); 
  }
  delay(200);


}