# Agents Office — คำสั่งลัด (พิมพ์ `make` เพื่อดูรายการ)
# Next.js โหลด .env / .env.production ให้เองอยู่แล้ว (ใส่ key ของ Claude / ChatGPT / Gemini ได้ในไฟล์นั้น)

PORT ?= 3000

.DEFAULT_GOAL := help
.PHONY: help setup install dev mock build start prod typecheck clean

help: ## แสดงรายการคำสั่ง
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

install: ## ติดตั้ง dependency
	npm install

setup: install ## ติดตั้ง + สร้าง .env จากตัวอย่าง (แล้วเปิดใส่ API key)
	@test -f .env && echo ".env มีอยู่แล้ว" || (cp .env.example .env && echo "สร้าง .env แล้ว — เปิดไฟล์นี้แล้วใส่ API key ของค่ายที่มี")

dev: ## รันโหมดพัฒนา (พอร์ต 3000 เปลี่ยนด้วย PORT=4000)
	npm run dev -- -p $(PORT)

mock: ## รันโหมดจำลอง ไม่เรียก AI จริง ไม่ต้องมี key
	MOCK=1 npm run dev -- -p $(PORT)

build: ## build สำหรับ production (ใช้ .env.production)
	npm run build

start: ## รัน production (ต้อง make build ก่อน)
	npm run start -- -p $(PORT)

prod: build ## build แล้วรัน production ต่อเลย
	npm run start -- -p $(PORT)

typecheck: ## ตรวจ TypeScript
	npm run typecheck

clean: ## ลบ cache ของ build (.next)
	rm -rf .next
