import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  ValidateNested,
  IsOptional,
  IsIn,
  Matches,
  IsBoolean,
  IsDefined,
} from "class-validator";
export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
export class RegisterDto extends LoginDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}
export class AddressDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
  @Transform(({ value }) =>
    typeof value === "string" ? value.replace(/[ -]/g, "") : value,
  )
  @ApiProperty()
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/)
  phone!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(180)
  street!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  city!: string;
}
export class ItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10) quantity!: number;
}
export class OrderDto {
  @ApiProperty({ type: [ItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((x: ItemDto) => x.productId)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];
  @ApiProperty({ type: AddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
  @ApiPropertyOptional()
  @IsOptional()
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,24}$/)
  coupon?: string;
}
export class PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 12;
  @ApiPropertyOptional()
  @IsOptional()
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  search?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  category?: string;
}
export class ProductDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9-]{3,40}$/) sku!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  category!: string;
  @ApiProperty() @IsInt() @Min(100) @Max(100000000) price!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) onHand!: number;
}
export class RestockDto {
  @ApiProperty() @IsInt() @Min(1) @Max(10000) quantity!: number;
}
export class PriceDto {
  @ApiProperty() @IsInt() @Min(100) @Max(100000000) price!: number;
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsBoolean() active!: boolean;
}
export class FulfillDto {
  @ApiProperty() @IsIn(["PACKED", "SHIPPED", "DELIVERED"]) status!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  tracking?: string;
}
export class ReasonDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
export class ReturnDecisionDto {
  @ApiProperty() @IsIn(["APPROVED", "REJECTED"]) status!: string;
}
export class CouponDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9_-]{3,24}$/) code!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(50) percent!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) minimum!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) maxUses!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(365) days!: number;
}
export class SimulateDto {
  @ApiProperty() @IsIn(["success", "failed"]) outcome!: string;
}
export class CheckoutDto {
  @ApiProperty() @IsIn(["stripe", "bkash"]) provider!: "stripe" | "bkash";
}
export class RefundDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  reference!: string;
}
export class WebhookDto {
  @ApiProperty() @IsUUID() paymentId!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  eventId!: string;
  @ApiProperty() @IsIn(["success", "failed"]) outcome!: string;
  @ApiProperty() @IsInt() @Min(1) amount!: number;
  @ApiProperty() @IsIn(["BDT"]) currency!: string;
}
